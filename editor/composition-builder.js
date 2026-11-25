/*
 * Composition builder for Ability Studio (V2 `composition` blueprints, spec section 5 "Editor").
 *
 * Three columns per rule: WHEN (a trigger), IF (conditions with all / any / not groups) and DO (effects).
 * Everything the builder knows comes from data files generated from the game: vocabulary.json (triggers,
 * conditions, effects, safety rules, slots), blocks.json (one entry per class declaration) and gates.json
 * (the library form of legacy gates, used by "Unpack"). The builder never invents a block.
 *
 * The file works in the browser (window.erCompositionBuilder) and in Node (module.exports), so the pure
 * logic (search, slot fit, sentences, validation) is unit-tested without a browser.
 */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module !== null && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.erCompositionBuilder = api;
  }
})(typeof window === "undefined" ? undefined : window, () => {
  // ---- constants ------------------------------------------------------------------------------

  const WHEN_SECTIONS = [
    { kind: "event", title: "Something happens" },
    { kind: "calc", title: "While the game calculates…" },
  ];
  const LIMITS = { rules: 32, conditionsPerRule: 16, effectsPerRule: 8, groupDepth: 4 };
  const KEY_PATTERN = /^[a-z0-9-]{2,48}$/;
  const RULE_KEYS = new Set(["key", "when", "if", "do", "chance"]);
  const BLOCK_KEYS = new Set(["block", "params"]);
  const STATEFUL_CONDITION_IDS = new Set(["rng.chance", "time.once-per", "time.nth-use"]);
  const PICKER_PAGE = 24;

  const VALUE_WORDS = {
    holder: "the ability owner",
    other: "the other Pokemon",
    ally: "my ally",
    lt: "below",
    lte: "at most",
    eq: "exactly",
    gte: "at least",
    gt: "above",
    exact: "exact",
    "floor-half": "rounded down",
    "holder-side": "my side",
    "opposing-side": "the foes' side",
    both: "both sides",
    foe: "a foe",
    self: "myself",
    single: "one target",
    "all-foes": "all foes",
    "all-others": "everyone else",
    "user-or-ally": "me or an ally",
    field: "the whole field",
    any: "any",
    berry: "a berry",
    NONE: "no",
    ANY: "any",
  };
  // Effect targets read better in the first person.
  const TARGET_WORDS = {
    holder: "me",
    other: "the other Pokemon",
    "holder-side": "me and my allies",
    "opposing-side": "all foes",
  };
  // Per-setting wording where the generic word reads badly ("has any", "the weather is no").
  const SPECIAL_WORDS = {
    status: { ANY: "any status", NONE: "no status" },
    stat: { ANY: "any stat" },
    weather: { NONE: "clear" },
    terrain: { NONE: "none" },
  };
  const PERCENT_PARAMS = new Set(["pct", "minPct", "maxPct", "percent"]);

  // ---- small helpers --------------------------------------------------------------------------

  const clone = value => JSON.parse(JSON.stringify(value));
  const isObject = value => typeof value === "object" && value !== null && !Array.isArray(value);
  const esc = value =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const pretty = value =>
    String(value)
      .replaceAll("_", " ")
      .replaceAll("-", " ")
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
  // Lower-cases the first letter so a label reads inside a sentence, except pronouns, acronyms and proper nouns.
  const lowerFirst = text =>
    text.length > 1 && !/^(I\b|Gravity\b|Trick Room\b|[A-Z]{2})/.test(text)
      ? text[0].toLowerCase() + text.slice(1)
      : text;
  const upperFirst = text => (text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text);

  function isGroup(node) {
    return isObject(node) && ("all" in node || "any" in node || "not" in node);
  }
  function groupKind(node) {
    return "all" in node ? "all" : "any" in node ? "any" : "not";
  }
  function childrenOf(node) {
    if (!isObject(node)) {
      return [];
    }
    if (Array.isArray(node.all)) {
      return node.all;
    }
    if (Array.isArray(node.any)) {
      return node.any;
    }
    if ("not" in node) {
      return node.not === null || node.not === undefined ? [] : [node.not];
    }
    return [];
  }

  // ---- param validation and slot logic (a port of the pure vocabulary, kept in step by a parity test) ----

  function validateParamValues(owner, defs, values) {
    const errors = [];
    const given = values ?? {};
    const known = new Set(defs.map(def => def.id));
    for (const key of Object.keys(given)) {
      if (!known.has(key)) {
        errors.push(`${owner} has no setting called "${key}"`);
      }
    }
    for (const def of defs) {
      const value = given[def.id];
      if (value === undefined) {
        continue;
      }
      switch (def.control) {
        case "number":
        case "slider": {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            errors.push(`${owner}: "${def.label}" must be a number`);
            break;
          }
          if (def.integer === true && !Number.isInteger(value)) {
            errors.push(`${owner}: "${def.label}" must be a whole number`);
          }
          if (def.min !== undefined && value < def.min) {
            errors.push(`${owner}: "${def.label}" must be at least ${def.min}`);
          }
          if (def.max !== undefined && value > def.max) {
            errors.push(`${owner}: "${def.label}" must be at most ${def.max}`);
          }
          break;
        }
        case "select":
          if (typeof value !== "string" || !(def.options ?? []).includes(value)) {
            errors.push(`${owner}: "${def.label}" must be one of ${(def.options ?? []).join(", ")}`);
          }
          break;
        case "boolean":
          if (typeof value !== "boolean") {
            errors.push(`${owner}: "${def.label}" must be yes or no`);
          }
          break;
        case "text":
          if (typeof value !== "string" || value.length > 120) {
            errors.push(`${owner}: "${def.label}" must be text of at most 120 characters`);
          }
          break;
      }
    }
    return errors;
  }

  const missingSlots = (requires, provides) => {
    const have = new Set(provides);
    return requires.filter(slot => !have.has(slot));
  };

  function conditionRequires(def, values) {
    const slots = new Set(def.requires);
    if (def.whoParam !== undefined) {
      const who = (values ?? {})[def.whoParam] ?? def.params.find(param => param.id === def.whoParam)?.default;
      if (who === "holder" || who === "other" || who === "ally") {
        slots.add(who);
      }
    }
    return [...slots];
  }

  const defaultParams = def => Object.fromEntries((def.params ?? []).map(param => [param.id, param.default]));

  // ---- the model ------------------------------------------------------------------------------

  /**
   * Builds the lookup model the UI and the tests use. `blocks` and `gates` are optional: without them the
   * builder still works, only the "Works as one piece" badge and "Unpack" go away.
   */
  function createModel(vocabulary, blocks, gates, options) {
    const opts = options || {};
    const slotsById = new Map(vocabulary.slots.map(slot => [slot.id, slot]));
    const whens = new Map(vocabulary.whens.map(when => [when.id, when]));
    const conditions = new Map(vocabulary.conditions.map(def => [def.id, def]));
    const effects = new Map(vocabulary.effects.map(def => [def.id, def]));
    const guards = new Map(vocabulary.guards.map(def => [def.id, def]));
    const blockList = Array.isArray(blocks?.blocks) ? blocks.blocks : [];
    const blocksByClass = new Map(blockList.map(block => [block.className ?? block.id, block]));
    const gateTable = isObject(gates?.gates) ? gates.gates : {};
    const moveNames = Array.isArray(opts.moveNames) ? opts.moveNames : [];

    const slotLabel = slot => slotsById.get(slot)?.label.toLowerCase() ?? slot;
    // For display only (the validation messages must stay identical to the game's, which lower-case everything).
    const slotDisplay = slot => {
      const label = slotsById.get(slot)?.label ?? slot;
      return label.length > 1 && label[1] === label[1].toLowerCase() ? label[0].toLowerCase() + label.slice(1) : label;
    };

    // ---- plain-language rendering ----

    function wordFor(paramId, value, def) {
      if (typeof value === "boolean") {
        return value ? "yes" : "no";
      }
      if (paramId === "ratio" && typeof value === "number") {
        return `${Math.round(value * 100)}%`;
      }
      if (PERCENT_PARAMS.has(paramId) && typeof value === "number") {
        return `${value}`;
      }
      if (paramId === "target" && typeof value === "string" && TARGET_WORDS[value] !== undefined) {
        return TARGET_WORDS[value];
      }
      const special = SPECIAL_WORDS[paramId]?.[value];
      if (special !== undefined) {
        return special;
      }
      if (typeof value === "string") {
        if (VALUE_WORDS[value] !== undefined) {
          return VALUE_WORDS[value];
        }
        if (def?.control === "select") {
          return pretty(value);
        }
        return value.length > 0 ? pretty(value) : "…";
      }
      return String(value);
    }

    function renderLabel(template, values, defs) {
      return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, key) => {
        if (!(key in values)) {
          const fallback = defs?.find(param => param.id === key)?.default;
          return fallback === undefined
            ? whole
            : wordFor(
                key,
                fallback,
                defs?.find(param => param.id === key),
              );
        }
        return wordFor(
          key,
          values[key],
          defs?.find(param => param.id === key),
        );
      });
    }

    const valuesOf = (def, ref) => ({ ...defaultParams(def), ...(isObject(ref?.params) ? ref.params : {}) });

    function describeCondition(node, topLevel = true) {
      if (!isObject(node)) {
        return "…";
      }
      if (isGroup(node)) {
        const kind = groupKind(node);
        const parts = childrenOf(node).map(child => describeCondition(child, false));
        if (kind === "not") {
          return parts.length === 0 ? "not …" : `it is not true that ${parts[0]}`;
        }
        if (parts.length === 0) {
          return "…";
        }
        const word = kind === "all" ? "and" : "or";
        const joined = parts.length === 1 ? parts[0] : parts.join(` ${word} `);
        return topLevel || parts.length === 1 ? joined : `(${joined})`;
      }
      const def = conditions.get(node.block);
      if (def === undefined) {
        return `an unknown condition "${node.block}"`;
      }
      return lowerFirst(renderLabel(def.label, valuesOf(def, node), def.params));
    }

    function describeEffect(ref) {
      const def = effects.get(ref?.block);
      if (def === undefined) {
        return `an unknown effect "${ref?.block}"`;
      }
      return lowerFirst(renderLabel(def.label, valuesOf(def, ref), def.params));
    }

    function describeWhen(ref) {
      const def = whens.get(ref?.block);
      return def === undefined ? "an unknown trigger" : def.label;
    }

    /** "When I enter the battle, if X and Y, switch out, then heal me by 10% of max HP." */
    function sentence(rule) {
      const when = describeWhen(rule?.when);
      const ifs = Array.isArray(rule?.if) ? rule.if : [];
      const ifText = ifs.length > 0 ? `, if ${ifs.map(node => describeCondition(node, false)).join(" and ")}` : "";
      const dos = Array.isArray(rule?.do) ? rule.do : [];
      const doText = dos.length > 0 ? dos.map(describeEffect).join(", then ") : "…";
      const chance = Number.isInteger(rule?.chance) && rule.chance < 100 ? ` (${rule.chance}% chance each time)` : "";
      return `${upperFirst(when)}${ifText}, ${doText}${chance}.`;
    }

    // ---- fit (is this block usable under this trigger) ----

    function whenFit(def) {
      if (def.kind === "while-active") {
        return { ok: false, reason: `"${def.label}" is an always-on flag, not a moment a rule can react to` };
      }
      if (def.baseClassOnly === true) {
        return { ok: false, reason: "a legacy grouping that the game never fires on its own" };
      }
      if (def.composable !== true) {
        return { ok: false, reason: "not wired into the block builder yet" };
      }
      return { ok: true, reason: "" };
    }

    function conditionFit(def, when, values) {
      if (def.escapeHatch === true) {
        return { ok: false, hidden: true, reason: "only appears on abilities that already use it" };
      }
      if (when !== undefined && when.kind === "calc" && (!def.pure || STATEFUL_CONDITION_IDS.has(def.id))) {
        return {
          ok: false,
          reason: "it rolls dice or remembers things, which cannot happen while the game is only calculating",
        };
      }
      if (when !== undefined) {
        const missing = missingSlots(conditionRequires(def, values ?? defaultParams(def)), when.provides);
        if (missing.length > 0) {
          return {
            ok: false,
            reason: `needs ${missing.map(slotDisplay).join(" and ")}, which "${when.label}" does not provide`,
          };
        }
      }
      return { ok: true, reason: "" };
    }

    function effectFit(def, when) {
      if (!def.implemented) {
        return { ok: false, planned: true, reason: "planned: not wired to the game code yet" };
      }
      if (when === undefined) {
        return { ok: true, reason: "" };
      }
      const missing = missingSlots(def.requires, when.provides);
      if (missing.length > 0) {
        return {
          ok: false,
          reason: `needs ${missing.map(slotDisplay).join(" and ")}, which "${when.label}" does not provide`,
        };
      }
      for (const guardId of def.guards ?? []) {
        const guard = guards.get(guardId);
        const guardMissing = guard === undefined ? [] : missingSlots(guard.requires, when.provides);
        if (guardMissing.length > 0) {
          return {
            ok: false,
            reason: `its safety rule needs ${guardMissing.map(slotDisplay).join(" and ")}, which "${when.label}" does not provide`,
          };
        }
      }
      if (def.kind === "calc") {
        if (when.kind !== "calc") {
          return {
            ok: false,
            reason: 'changes a value the game is calculating; pick a "while the game calculates" trigger',
          };
        }
        if (when.modifies !== def.modifies) {
          return { ok: false, reason: `changes ${def.modifies}, but "${when.label}" lets you change ${when.modifies}` };
        }
      } else if (def.kind === "event" && when.kind !== "event") {
        return { ok: false, reason: 'something that happens; pick a "something happens" trigger' };
      }
      return { ok: true, reason: "" };
    }

    // ---- search ----

    function tokensOf(query) {
      return String(query || "")
        .toLowerCase()
        .split(/[^a-z0-9%]+/)
        .filter(Boolean);
    }

    function tokenScore(token, fields) {
      // "taking" should find "take", "moves" should find "move".
      const variants = new Set([token]);
      if (token.length > 3 && token.endsWith("s")) {
        variants.add(token.slice(0, -1));
      }
      if (token.length > 4 && token.endsWith("ing")) {
        variants.add(token.slice(0, -3));
        variants.add(`${token.slice(0, -3)}e`);
      }
      if (token.length > 3 && token.endsWith("ed")) {
        variants.add(token.slice(0, -2));
        variants.add(token.slice(0, -1));
      }
      let best = 0;
      for (const variant of variants) {
        const label = fields.label;
        if (label.split(/[^a-z0-9%]+/).some(word => word.startsWith(variant))) {
          best = Math.max(best, label.startsWith(variant) ? 120 : 100);
        } else if (label.includes(variant)) {
          best = Math.max(best, 80);
        }
        for (const synonym of fields.synonyms) {
          if (synonym === variant || synonym.startsWith(variant)) {
            best = Math.max(best, 90);
          } else if (synonym.includes(variant)) {
            best = Math.max(best, 70);
          }
        }
        if (fields.examples.some(example => example.includes(variant))) {
          best = Math.max(best, 50);
        }
        if (fields.group.includes(variant)) {
          best = Math.max(best, 25);
        }
      }
      return best;
    }

    function rankBy(items, query, fieldsOf) {
      const tokens = tokensOf(query);
      if (tokens.length === 0) {
        return items.map(item => ({ item, score: 0 }));
      }
      const ranked = [];
      items.forEach((item, order) => {
        const fields = fieldsOf(item);
        let total = 0;
        for (const token of tokens) {
          const score = tokenScore(token, fields);
          if (score === 0) {
            return;
          }
          total += score;
        }
        ranked.push({ item, score: total, order });
      });
      ranked.sort((a, b) => b.score - a.score || a.order - b.order);
      return ranked;
    }

    const fieldsForWhen = def => ({
      label: def.label.toLowerCase(),
      synonyms: (def.synonyms ?? []).map(s => s.toLowerCase()),
      examples: [],
      group: `${def.group} ${def.kind === "calc" ? "calculates calculation" : "happens"}`.toLowerCase(),
    });
    const fieldsForCondition = def => ({
      label: renderLabel(def.label, defaultParams(def), def.params).toLowerCase(),
      synonyms: def.synonyms.map(s => s.toLowerCase()),
      examples: def.examples.map(s => s.toLowerCase()),
      group: def.group.toLowerCase(),
    });
    const fieldsForEffect = def => ({
      label: renderLabel(def.label, defaultParams(def), def.params).toLowerCase(),
      synonyms: def.synonyms.map(s => s.toLowerCase()),
      examples: def.examples.map(s => s.toLowerCase()),
      group: def.kind === "calc" ? "calculation change" : def.kind === "package" ? "one piece" : "event",
    });

    function searchWhens(query, showAll) {
      const all = vocabulary.whens.filter(def => def.kind !== "while-active" && def.baseClassOnly !== true);
      const usable = all.filter(def => whenFit(def).ok);
      const pool = showAll ? all : usable;
      const results = rankBy(pool, query, fieldsForWhen).map(({ item }) => ({ def: item, fit: whenFit(item) }));
      return { results, hidden: all.length - usable.length };
    }

    /** Conditions usable under `whenId`, best match first. `hidden` counts the ones the trigger cannot provide for. */
    function searchConditions(query, whenId, showAll) {
      const when = whens.get(whenId);
      const authorable = vocabulary.conditions.filter(def => def.escapeHatch !== true);
      const fitted = authorable.map(def => ({ def, fit: conditionFit(def, when) }));
      const pool = showAll ? fitted : fitted.filter(entry => entry.fit.ok);
      const ranked = rankBy(pool, query, entry => fieldsForCondition(entry.def)).map(({ item }) => item);
      return { results: ranked, hidden: fitted.filter(entry => !entry.fit.ok).length };
    }

    function searchEffects(query, whenId, showAll) {
      const when = whens.get(whenId);
      const fitted = vocabulary.effects.map(def => ({ def, fit: effectFit(def, when) }));
      // Planned effects are always listed after the usable ones, so staff can see what is coming.
      const usable = fitted.filter(entry => entry.fit.ok);
      const unusable = fitted.filter(entry => !entry.fit.ok);
      const pool = showAll ? [...usable, ...unusable] : usable;
      const ranked = rankBy(pool, query, entry => fieldsForEffect(entry.def)).map(({ item }) => item);
      return { results: ranked, hidden: unusable.length };
    }

    // ---- validation: a faithful port of validate-composition.ts (a test compares them) ----

    function slotWords(slots) {
      return slots.map(slotLabel).join(" and ");
    }
    function describeMissing(block, when, missing) {
      return `"${block}" needs ${slotWords(missing)}, but the trigger "${when.label}" does not provide ${missing.length > 1 ? "them" : "it"}`;
    }

    function checkRefShape(ref, path, errors) {
      if (!isObject(ref)) {
        errors.push(`${path} must be an object with a "block"`);
        return false;
      }
      for (const key of Object.keys(ref)) {
        if (!BLOCK_KEYS.has(key)) {
          errors.push(`${path} has an unknown field "${key}"`);
        }
      }
      if (typeof ref.block !== "string" || ref.block.length === 0) {
        errors.push(`${path} needs a "block" id`);
        return false;
      }
      if (ref.params !== undefined && !isObject(ref.params)) {
        errors.push(`${path}.params must be an object`);
        return false;
      }
      return true;
    }

    function validateCondition(node, path, when, depth, errors) {
      if (!isObject(node)) {
        errors.push(`${path} must be an object`);
        return;
      }
      const groupKeys = ["all", "any", "not"].filter(key => key in node);
      if (groupKeys.length > 0) {
        if (groupKeys.length > 1 || Object.keys(node).length > 1) {
          errors.push(`${path} mixes group operators; use one of all, any or not`);
          return;
        }
        if (depth >= LIMITS.groupDepth) {
          errors.push(`${path} nests groups more than ${LIMITS.groupDepth} levels deep`);
          return;
        }
        if (groupKeys[0] === "not") {
          validateCondition(node.not, `${path}.not`, when, depth + 1, errors);
          return;
        }
        const list = groupKeys[0] === "all" ? node.all : node.any;
        if (!Array.isArray(list) || list.length === 0 || list.length > LIMITS.conditionsPerRule) {
          errors.push(`${path} groups need between 1 and ${LIMITS.conditionsPerRule} conditions`);
          return;
        }
        list.forEach((child, index) =>
          validateCondition(child, `${path}.${groupKeys[0]}[${index}]`, when, depth + 1, errors),
        );
        return;
      }
      if (!checkRefShape(node, path, errors)) {
        return;
      }
      const def = conditions.get(node.block);
      if (def === undefined) {
        errors.push(`${path}: there is no condition called "${node.block}"`);
        return;
      }
      if (def.escapeHatch === true) {
        errors.push(`${path}: "${def.id}" cannot be added by hand; it only appears on abilities that already use it`);
        return;
      }
      if (when.kind === "calc" && (!def.pure || STATEFUL_CONDITION_IDS.has(def.id))) {
        errors.push(
          `${path}: "${def.id}" rolls dice or remembers things, so it cannot be used while the game is only calculating ("${when.label}"); use a "something happens" trigger`,
        );
        return;
      }
      const paramErrors = validateParamValues(def.id, def.params, node.params);
      if (paramErrors.length > 0) {
        errors.push(...paramErrors.map(message => `${path}: ${message}`));
        return;
      }
      const values = { ...defaultParams(def), ...(node.params ?? {}) };
      const missing = missingSlots(conditionRequires(def, values), when.provides);
      if (missing.length > 0) {
        errors.push(`${path}: ${describeMissing(def.id, when, missing)}`);
      }
    }

    function validateEffect(ref, path, when, errors) {
      if (!checkRefShape(ref, path, errors)) {
        return;
      }
      const def = effects.get(ref.block);
      if (def === undefined) {
        errors.push(`${path}: there is no effect called "${ref.block}"`);
        return;
      }
      if (!def.implemented) {
        errors.push(
          `${path}: "${def.id}" cannot run yet. It is listed so it can be planned, but it is not wired to the game code`,
        );
        return;
      }
      const paramErrors = validateParamValues(def.id, def.params, ref.params);
      if (paramErrors.length > 0) {
        errors.push(...paramErrors.map(message => `${path}: ${message}`));
        return;
      }
      const missing = missingSlots(def.requires, when.provides);
      if (missing.length > 0) {
        errors.push(`${path}: ${describeMissing(def.id, when, missing)}`);
      }
      for (const guardId of def.guards ?? []) {
        const guard = guards.get(guardId);
        const guardMissing = guard === undefined ? [] : missingSlots(guard.requires, when.provides);
        if (guardMissing.length > 0) {
          errors.push(
            `${path}: its safety rule "${guardId}" needs ${slotWords(guardMissing)}, but the trigger "${when.label}" does not provide ${guardMissing.length > 1 ? "them" : "it"}`,
          );
        }
      }
      if (def.kind === "calc") {
        if (when.kind !== "calc") {
          errors.push(
            `${path}: "${def.id}" changes a value the game is calculating, but "${when.label}" is an event; pick a "while the game calculates" trigger`,
          );
        } else if (when.modifies !== def.modifies) {
          errors.push(
            `${path}: "${def.id}" changes ${def.modifies}, but "${when.label}" lets you change ${when.modifies}`,
          );
        }
      } else if (def.kind === "event" && when.kind !== "event") {
        errors.push(
          `${path}: "${def.id}" is something that happens, but "${when.label}" is a calculation moment; pick a "something happens" trigger`,
        );
      }
    }

    function validate(rules, path = "composition") {
      const errors = [];
      if (!Array.isArray(rules)) {
        return [`${path} must be an array`];
      }
      if (rules.length > LIMITS.rules) {
        errors.push(`${path} must contain at most ${LIMITS.rules} rules`);
      }
      const keys = new Set();
      rules.forEach((rule, index) => {
        const rulePath = `${path}[${index}]`;
        if (!isObject(rule)) {
          errors.push(`${rulePath} must be an object`);
          return;
        }
        for (const key of Object.keys(rule)) {
          if (!RULE_KEYS.has(key)) {
            errors.push(`${rulePath} has an unknown field "${key}"`);
          }
        }
        if (typeof rule.key !== "string" || !KEY_PATTERN.test(rule.key)) {
          errors.push(`${rulePath}.key must use 2-48 lowercase letters, digits and hyphens`);
        } else if (keys.has(rule.key)) {
          errors.push(`${path} has duplicate key ${rule.key}`);
        } else {
          keys.add(rule.key);
        }
        if (!Number.isInteger(rule.chance) || rule.chance < 1 || rule.chance > 100) {
          errors.push(`${rulePath}.chance must be a whole number from 1 to 100`);
        }
        if (!checkRefShape(rule.when, `${rulePath}.when`, errors)) {
          return;
        }
        const when = whens.get(rule.when.block);
        if (when === undefined) {
          errors.push(`${rulePath}.when: there is no trigger called "${rule.when.block}"`);
          return;
        }
        if (when.kind === "while-active") {
          errors.push(`${rulePath}.when: "${when.label}" is an always-on flag, not a moment a rule can react to`);
          return;
        }
        if (when.baseClassOnly === true) {
          errors.push(
            `${rulePath}.when: "${when.label}" is a legacy grouping that the game never fires on its own; pick a specific trigger`,
          );
          return;
        }
        if (when.composable !== true) {
          errors.push(
            `${rulePath}.when: "${when.label}" cannot be used in a rule yet. It is listed so it can be planned, but the game wiring for it is not verified`,
          );
          return;
        }
        if (when.kind === "calc" && typeof rule.chance === "number" && rule.chance < 100) {
          errors.push(
            `${rulePath}.chance must be 100 for "${when.label}": a random roll cannot happen while the game is only calculating`,
          );
        }
        if (rule.when.params !== undefined && Object.keys(rule.when.params).length > 0) {
          errors.push(`${rulePath}.when: triggers take no settings`);
        }
        if (rule.if !== undefined) {
          if (!Array.isArray(rule.if) || rule.if.length > LIMITS.conditionsPerRule) {
            errors.push(`${rulePath}.if must be a list of at most ${LIMITS.conditionsPerRule} conditions`);
          } else {
            rule.if.forEach((node, nodeIndex) =>
              validateCondition(node, `${rulePath}.if[${nodeIndex}]`, when, 0, errors),
            );
          }
        }
        if (!Array.isArray(rule.do) || rule.do.length === 0 || rule.do.length > LIMITS.effectsPerRule) {
          errors.push(`${rulePath}.do must list between 1 and ${LIMITS.effectsPerRule} effects`);
        } else {
          rule.do.forEach((effect, effectIndex) =>
            validateEffect(effect, `${rulePath}.do[${effectIndex}]`, when, errors),
          );
        }
      });
      return errors;
    }

    // ---- safety rules (guards) and "also requires" lines of a rule ----

    function safetyLines(rule) {
      const lines = [];
      const seen = new Set();
      for (const ref of Array.isArray(rule?.do) ? rule.do : []) {
        const def = effects.get(ref?.block);
        for (const guardId of def?.guards ?? []) {
          if (seen.has(guardId)) {
            continue;
          }
          seen.add(guardId);
          const guard = guards.get(guardId);
          lines.push({
            id: guardId,
            label: guard?.label ?? guardId,
            why: guard?.why ?? "",
            source: guard?.formula?.source ?? "",
            expr: guard?.formula?.expr ?? "",
            from: def.label,
          });
        }
      }
      return lines;
    }

    function feasibilityLines(rule) {
      const lines = [];
      for (const ref of Array.isArray(rule?.do) ? rule.do : []) {
        const def = effects.get(ref?.block);
        for (const text of def?.feasibility ?? []) {
          lines.push({ text, from: renderLabel(def.label, valuesOf(def, ref), def.params) });
        }
      }
      return lines;
    }

    // ---- packages and "Unpack" ----

    const isPackageClass = className => blocksByClass.get(className)?.kind === "package";
    const packageReason = className => blocksByClass.get(className)?.packageReason ?? "";

    function uniqueRuleKey(list, wanted) {
      const used = new Set((list ?? []).map(rule => rule.key));
      const root = String(wanted || "rule")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      const base = root.length >= 2 ? root : "rule";
      let key = base;
      let suffix = 2;
      while (used.has(key)) {
        key = `${base.slice(0, 44)}-${suffix++}`;
      }
      return key;
    }

    /**
     * Can the legacy rule `entry.componentRules[ruleIndex]` be unpacked at its event gate (conditionIndex)?
     * Returns `{ available, reason, rule }`; `rule` is the V2 composition rule that replaces it.
     */
    function unpackInfo(entry, ruleIndex, conditionIndex) {
      const legacy = entry?.componentRules?.[ruleIndex];
      const gateRef = legacy?.conditions?.[conditionIndex];
      if (!legacy || !gateRef || gateRef.kind !== "event") {
        return { available: false, reason: "this is not an event gate" };
      }
      const source = legacy.hook;
      const gate = gateTable[`${source?.abilityId}:${source?.attrIndex}`];
      if (gate === undefined) {
        return { available: false, reason: "no block form of this gate has been written yet" };
      }
      if (gate.unpackable !== true) {
        return { available: false, reason: gate.reason ?? "this gate cannot be unpacked yet" };
      }
      const sameAttr = ref =>
        ref
        && ref.abilityId === source.abilityId
        && ref.attrIndex === source.attrIndex
        && ref.attrType === source.attrType;
      if (gate.className !== source.attrType || !sameAttr(gateRef)) {
        return { available: false, reason: "this gate does not belong to the same effect as the trigger" };
      }
      if ((legacy.prerequisiteHooks ?? []).length > 0) {
        return { available: false, reason: "remove the chained triggers first" };
      }
      if (legacy.conditions.length !== 1) {
        return { available: false, reason: "remove the other conditions first, or keep them in a separate rule" };
      }
      if (legacy.effects.length !== 1 || !sameAttr(legacy.effects[0])) {
        return { available: false, reason: "the rule runs more than this one effect" };
      }
      const customised = [legacy.hook, gateRef, ...legacy.effects].some(
        ref => isObject(ref.parameterOverrides) && Object.keys(ref.parameterOverrides).length > 0,
      );
      if (customised) {
        return {
          available: false,
          reason: "its settings were changed; restore them (the reset arrows) before unpacking",
        };
      }
      const composed = {
        key: uniqueRuleKey(entry.composition, legacy.key),
        when: { block: gate.when },
        ...(gate.if.length > 0 ? { if: clone(gate.if) } : {}),
        do: clone(gate.do),
        chance: Number.isInteger(legacy.chance) ? legacy.chance : 100,
      };
      const problems = validate([composed]);
      if (problems.length > 0) {
        return { available: false, reason: problems[0].replace(/^composition\[0\][^:]*:\s*/, "") };
      }
      return { available: true, reason: "", rule: composed };
    }

    return {
      vocabulary,
      stale: Boolean(blocks?.vocabularyHash) && blocks.vocabularyHash !== vocabulary.hash,
      moveNames,
      when: id => whens.get(id),
      condition: id => conditions.get(id),
      effect: id => effects.get(id),
      guard: id => guards.get(id),
      block: className => blocksByClass.get(className),
      slotLabel,
      slotDisplay,
      defaultParams,
      renderLabel,
      describeCondition,
      describeEffect,
      describeWhen,
      sentence,
      whenFit,
      conditionFit,
      effectFit,
      searchWhens,
      searchConditions,
      searchEffects,
      validate,
      safetyLines,
      feasibilityLines,
      isPackageClass,
      packageReason,
      uniqueRuleKey,
      unpackInfo,
    };
  }

  // ---- rule edits (pure: they mutate the given entry and nothing else) --------------------------

  const parsePath = text => (text === "" || text === undefined ? [] : String(text).split(".").map(Number));
  const joinPath = parts => parts.join(".");

  function nodeAt(list, path) {
    let nodes = list;
    let node;
    for (const index of path) {
      node = nodes?.[index];
      if (node === undefined || node === null) {
        return;
      }
      nodes = childrenOf(node);
    }
    return node;
  }

  /** The array a new condition should be pushed into for container `path` ([] is the top-level list). */
  function containerOf(rule, path) {
    if (path.length === 0) {
      rule.if ||= [];
      return { kind: "top", list: rule.if, node: null };
    }
    const node = nodeAt(rule.if || [], path);
    if (!isObject(node) || !isGroup(node)) {
      return;
    }
    const kind = groupKind(node);
    return kind === "not" ? { kind: "not", node } : { kind, list: node[kind], node };
  }

  function addCondition(rule, containerPath, node) {
    const container = containerOf(rule, containerPath);
    if (container === undefined) {
      return false;
    }
    if (container.kind === "not") {
      if (container.node.not !== null && container.node.not !== undefined) {
        return false;
      }
      container.node.not = node;
      return true;
    }
    if (container.list.length >= LIMITS.conditionsPerRule) {
      return false;
    }
    container.list.push(node);
    return true;
  }

  function removeCondition(rule, path) {
    const parentPath = path.slice(0, -1);
    const index = path.at(-1);
    const container = containerOf(rule, parentPath);
    if (container === undefined) {
      return false;
    }
    if (container.kind === "not") {
      container.node.not = null;
      return true;
    }
    container.list.splice(index, 1);
    return true;
  }

  function moveCondition(rule, path, offset) {
    const container = containerOf(rule, path.slice(0, -1));
    const index = path.at(-1);
    if (container === undefined || container.kind === "not") {
      return false;
    }
    const target = index + offset;
    if (target < 0 || target >= container.list.length) {
      return false;
    }
    [container.list[index], container.list[target]] = [container.list[target], container.list[index]];
    return true;
  }

  /** Changes a group between all / any / not. `not` keeps exactly one child, so a wider group cannot become one. */
  function setGroupKind(rule, path, kind) {
    const node = nodeAt(rule.if || [], path);
    if (!isObject(node) || !isGroup(node) || groupKind(node) === kind) {
      return false;
    }
    const children = childrenOf(node);
    if (kind === "not" && children.length > 1) {
      return false;
    }
    const next = kind === "not" ? { not: children[0] ?? null } : { [kind]: [...children] };
    for (const key of ["all", "any", "not"]) {
      delete node[key];
    }
    Object.assign(node, next);
    return true;
  }

  function swapIn(list, index, offset) {
    const target = index + offset;
    if (target < 0 || target >= list.length) {
      return false;
    }
    [list[index], list[target]] = [list[target], list[index]];
    return true;
  }

  function newGroup(kind) {
    return kind === "not" ? { not: null } : { [kind]: [] };
  }

  function newRule(rules, whenId) {
    const used = new Set(rules.map(rule => rule.key));
    let number = rules.length + 1;
    while (used.has(`rule-${number}`)) {
      number++;
    }
    return { key: `rule-${number}`, when: { block: whenId }, if: [], do: [], chance: 100 };
  }

  /**
   * "Upgrade to blocks": stamps the blueprint version 2 and adds an empty `composition`. Every other
   * field, and so every compiled attr, stays exactly as it was (spec 5: the migration only adds `composition: []`).
   */
  function upgradeEntry(entry) {
    if (!isObject(entry)) {
      return false;
    }
    entry.version = 2;
    if (!Array.isArray(entry.composition)) {
      entry.composition = [];
    }
    return true;
  }

  const isUpgraded = entry => Array.isArray(entry?.composition);

  // ---- UI -------------------------------------------------------------------------------------

  const ui = { key: null, picker: null, info: new Set(), classicOpen: new Set() };

  function resetUi(key) {
    if (ui.key !== key) {
      ui.key = key;
      ui.picker = null;
      ui.info = new Set();
    }
  }

  function badgeHtml(model, className) {
    if (!model.isPackageClass(className)) {
      return "";
    }
    const reason = model.packageReason(className);
    return `<span class="cb-badge cb-badge-package" title="${esc(reason || "A single mechanic that cannot be split into smaller blocks. You can still set its settings and reuse it as a whole.")}">Works as one piece</span>`;
  }

  function optionText(value, def) {
    const given = def?.optionLabels?.[value];
    if (given !== undefined) {
      return given;
    }
    const words = VALUE_WORDS[value];
    return words === undefined ? pretty(value) : upperFirst(words);
  }

  function formatOutput(def, value) {
    if (def.id === "ratio" && typeof value === "number") {
      return `${Math.round(value * 100)}%`;
    }
    if (PERCENT_PARAMS.has(def.id)) {
      return `${value}%`;
    }
    return String(value);
  }

  function paramControlHtml(model, def, value, target) {
    const current = value === undefined ? def.default : value;
    const attrs = `data-cb-param="${esc(def.id)}" data-cb-rule="${target.rule}" data-cb-target="${target.part}" data-cb-path="${esc(target.path)}"`;
    const label = esc(def.label);
    let control = "";
    switch (def.control) {
      case "number":
        control = `<input type="number" ${def.min === undefined ? "" : `min="${def.min}"`} ${def.max === undefined ? "" : `max="${def.max}"`} ${def.step === undefined ? "" : `step="${def.step}"`} value="${esc(current)}" aria-label="${label}" ${attrs}>`;
        break;
      case "slider":
        control = `<span class="cb-slider"><input type="range" min="${def.min ?? 0}" max="${def.max ?? 100}" step="${def.step ?? 1}" value="${esc(current)}" aria-label="${label}" ${attrs}><output data-cb-output>${esc(formatOutput(def, current))}</output></span>`;
        break;
      case "select":
        control = `<select aria-label="${label}" ${attrs}>${(def.options ?? [])
          .map(
            option =>
              `<option value="${esc(option)}"${option === current ? " selected" : ""}>${esc(optionText(option, def))}</option>`,
          )
          .join("")}</select>`;
        break;
      case "boolean":
        control = `<input type="checkbox" aria-label="${label}" ${current === true ? "checked" : ""} ${attrs}>`;
        break;
      default: {
        const list = def.id === "moveId" && model.moveNames.length > 0 ? ' list="cb-move-names"' : "";
        control = `<input type="text" maxlength="120" value="${esc(current)}" aria-label="${label}" ${list} ${attrs}>`;
      }
    }
    return `<label class="cb-param cb-param-${esc(def.control)}"><span>${label}</span>${control}</label>`;
  }

  function paramsHtml(model, def, ref, target) {
    if (!def.params || def.params.length === 0) {
      return "";
    }
    const values = ref.params || {};
    return `<div class="cb-params">${def.params.map(param => paramControlHtml(model, param, values[param.id], target)).join("")}</div>`;
  }

  /** Errors of one rule, grouped by the part they belong to ("when", "chance", "if[0].all[1]", "do[0]", "other"). */
  function errorsByPart(errors, ruleIndex) {
    const prefix = `composition[${ruleIndex}]`;
    const byPart = new Map();
    for (const message of errors) {
      if (!message.startsWith(prefix)) {
        continue;
      }
      const rest = message.slice(prefix.length);
      const match = /^\.((?:when|chance|key|if|do)(?:\[\d+\]|\.(?:all|any|not)(?:\[\d+\])?)*)/.exec(rest);
      const part = match ? match[1] : "other";
      if (!byPart.has(part)) {
        byPart.set(part, []);
      }
      byPart.get(part).push(message);
    }
    return byPart;
  }

  /** Strips the machine path and ids from a validation message for the person building the rule. */
  function friendly(model, message) {
    if (/\.not must be an object$/.test(message)) {
      return "this NOT group needs the condition that must not be true";
    }
    const groupSize = /groups need between 1 and (\d+) conditions$/.exec(message);
    if (groupSize) {
      return `this group needs between 1 and ${groupSize[1]} conditions`;
    }
    const rest = message.replace(/^composition\[\d+\](?:\.[A-Za-z]+(?:\[\d+\])?|\[\d+\])*:?\s*/, "");
    return rest.replace(
      /\b((?:hp|move|field|status|tag|stage|time|item|side|party|mon|rng|effect)\.[a-z0-9.-]+)/g,
      id => {
        const def = model.condition(id) || model.effect(id);
        return def ? `"${model.renderLabel(def.label, model.defaultParams(def), def.params)}"` : id;
      },
    );
  }

  function lockIcon() {
    return '<svg class="cb-lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M5 7V5a3 3 0 0 1 6 0v2h1v7H4V7zm1.5 0h3V5a1.5 1.5 0 0 0-3 0z" fill="currentColor"/></svg>';
  }

  function infoPopover(infoKey, why, source, expr) {
    const open = ui.info.has(infoKey);
    return `<button type="button" class="cb-info" aria-label="Why is this a safety rule?" aria-expanded="${open}" data-cb-action="toggle-info" data-cb-info="${esc(infoKey)}">i</button>${
      open
        ? `<div class="cb-popover" role="note"><p>${esc(why)}</p>${expr ? `<p class="cb-popover-formula"><b>The exact check:</b> <code>${esc(expr)}</code></p>` : ""}${source ? `<p class="cb-popover-source">${esc(source)}</p>` : ""}<p class="cb-popover-note">Safety rules cannot be removed. Removing one would cause a bug rather than change what the ability does.</p></div>`
        : ""
    }`;
  }

  function whenColumnHtml(model, rule, ruleIndex, errorMap) {
    const when = model.when(rule.when?.block);
    const picker =
      ui.picker && ui.picker.rule === ruleIndex && ui.picker.part === "when" ? pickerHtml(model, rule) : "";
    const provides = when
      ? when.provides.filter(slot => slot !== "simulated").map(slot => model.slotDisplay(slot))
      : [];
    const kindLabel = when ? (when.kind === "calc" ? "While the game calculates…" : "Something happens") : "";
    const errors = (errorMap.get("when") || [])
      .map(message => `<p class="cb-error">${esc(friendly(model, message))}</p>`)
      .join("");
    return `<section class="cb-col cb-when" aria-label="WHEN"><h4 class="cb-col-title"><span class="as-builder-label when">WHEN</span></h4>
      <div class="cb-when-card"><b data-cb-label="when">${esc(when ? when.label : rule.when?.block || "Pick a trigger")}</b>${kindLabel ? `<small class="cb-kind cb-kind-${when.kind}">${esc(kindLabel)}</small>` : ""}
      ${provides.length > 0 ? `<small class="cb-provides">The rule can look at: ${esc(provides.join(", "))}</small>` : ""}</div>
      ${errors}
      <button type="button" class="cb-small" data-cb-action="open-picker" data-cb-part="when" data-cb-rule="${ruleIndex}" aria-haspopup="dialog">Change trigger</button>${picker}</section>`;
  }

  function nodeHtml(model, rule, ruleIndex, node, path, siblings, errorMap, rulePrefix) {
    const pathText = joinPath(path);
    const index = path.at(-1);
    const errorPart = `if${path.map((_, i) => (i === 0 ? `[${path[0]}]` : `.${groupKindAt(rule, path.slice(0, i))}${groupKindAt(rule, path.slice(0, i)) === "not" ? "" : `[${path[i]}]`}`)).join("")}`;
    const nodeErrors = [...(errorMap.get(errorPart) || []), ...(errorMap.get(`${errorPart}.not`) || [])];
    const messages = nodeErrors.map(message => `<p class="cb-error">${esc(friendly(model, message))}</p>`).join("");
    const controls = `<span class="cb-node-actions"><button type="button" class="icon cb-move" title="Move up" aria-label="Move this condition up" data-cb-action="node-up" data-cb-rule="${ruleIndex}" data-cb-path="${pathText}"${index === 0 ? " disabled" : ""}>↑</button><button type="button" class="icon cb-move" title="Move down" aria-label="Move this condition down" data-cb-action="node-down" data-cb-rule="${ruleIndex}" data-cb-path="${pathText}"${index >= siblings - 1 ? " disabled" : ""}>↓</button><button type="button" class="icon danger" title="Remove" aria-label="Remove this condition" data-cb-action="remove-node" data-cb-rule="${ruleIndex}" data-cb-path="${pathText}">×</button></span>`;
    if (isObject(node) && isGroup(node)) {
      const kind = groupKind(node);
      const children = childrenOf(node);
      const container = containerOf(rule, path);
      const full = kind === "not" ? children.length > 0 : children.length >= LIMITS.conditionsPerRule;
      const canNest = path.length < LIMITS.groupDepth;
      const kindOptions = [
        ["all", "All of these (and)"],
        ["any", "Any of these (or)"],
        ["not", "None of these (not)"],
      ]
        .map(
          ([value, text]) =>
            `<option value="${value}"${value === kind ? " selected" : ""}${value === "not" && children.length > 1 ? " disabled" : ""}>${text}</option>`,
        )
        .join("");
      const inner = children
        .map(
          (child, childIndex) =>
            `${childIndex > 0 && kind !== "not" ? `<span class="cb-connector">${kind === "all" ? "AND" : "OR"}</span>` : ""}${nodeHtml(model, rule, ruleIndex, child, [...path, childIndex], children.length, errorMap, rulePrefix)}`,
        )
        .join("");
      const picker =
        ui.picker && ui.picker.rule === ruleIndex && ui.picker.part === "if" && ui.picker.path === pathText
          ? pickerHtml(model, rule)
          : "";
      const empty =
        children.length === 0
          ? `<p class="cb-empty">${kind === "not" ? "Add the condition that must NOT be true." : "Add at least one condition to this group."}</p>`
          : "";
      return `<div class="cb-group cb-group-${kind}" data-cb-node="${pathText}"><div class="cb-group-head"><select aria-label="Group type" data-cb-group-type data-cb-rule="${ruleIndex}" data-cb-path="${pathText}">${kindOptions}</select>${controls}</div>${messages}<div class="cb-group-body">${inner}${empty}${
        container === undefined
          ? ""
          : `<div class="cb-adders"><button type="button" class="cb-small" data-cb-action="open-picker" data-cb-part="if" data-cb-rule="${ruleIndex}" data-cb-path="${pathText}"${full ? " disabled" : ""}>+ Condition</button>${
              kind === "not"
                ? ""
                : ["all", "any", "not"]
                    .map(
                      groupType =>
                        `<button type="button" class="cb-small cb-ghost" data-cb-action="add-group" data-cb-group="${groupType}" data-cb-rule="${ruleIndex}" data-cb-path="${pathText}"${full || !canNest ? " disabled" : ""}>+ ${groupType === "all" ? "All of" : groupType === "any" ? "Any of" : "Not"}</button>`,
                    )
                    .join("")
            }</div>`
      }${picker}</div></div>`;
    }
    const def = model.condition(node?.block);
    const target = { rule: ruleIndex, part: "if", path: pathText };
    return `<div class="cb-leaf" data-cb-node="${pathText}"><div class="cb-leaf-head"><b data-cb-label="if:${pathText}">${esc(def ? upperFirst(model.describeCondition(node)) : `Unknown condition "${node?.block}"`)}</b>${controls}</div>${def ? paramsHtml(model, def, node, target) : ""}${messages}</div>`;
  }

  function groupKindAt(rule, path) {
    const node = nodeAt(rule.if || [], path);
    return isObject(node) && isGroup(node) ? groupKind(node) : "all";
  }

  function ifColumnHtml(model, rule, ruleIndex, errorMap) {
    const safety = model.safetyLines(rule);
    const feasibility = model.feasibilityLines(rule);
    const ifs = Array.isArray(rule.if) ? rule.if : [];
    const lines = [
      ...safety.map(
        line =>
          `<li class="cb-safety-line">${lockIcon()}<span class="cb-safety-tag">Safety rule</span><span class="cb-safety-text">${esc(line.label)}</span>${infoPopover(`guard:${ruleIndex}:${line.id}`, line.why, line.source, line.expr)}</li>`,
      ),
      ...feasibility.map(
        line =>
          `<li class="cb-safety-line cb-also">${lockIcon()}<span class="cb-safety-tag">Also requires</span><span class="cb-safety-text">${esc(line.text)}</span></li>`,
      ),
    ];
    const body = ifs
      .map(
        (node, nodeIndex) =>
          `${nodeIndex > 0 ? '<span class="cb-connector">AND</span>' : ""}${nodeHtml(model, rule, ruleIndex, node, [nodeIndex], ifs.length, errorMap)}`,
      )
      .join("");
    const topError = (errorMap.get("if") || [])
      .map(message => `<p class="cb-error">${esc(friendly(model, message))}</p>`)
      .join("");
    const picker =
      ui.picker && ui.picker.rule === ruleIndex && ui.picker.part === "if" && ui.picker.path === ""
        ? pickerHtml(model, rule)
        : "";
    const full = ifs.length >= LIMITS.conditionsPerRule;
    return `<section class="cb-col cb-if" aria-label="IF"><h4 class="cb-col-title"><span class="as-builder-label if">IF</span></h4>
      ${lines.length > 0 ? `<ul class="cb-safety" aria-label="Locked rules">${lines.join("")}</ul>` : ""}
      <div class="cb-conditions">${body || `<p class="cb-empty cb-always">Always (no conditions).</p>`}</div>${topError}
      <div class="cb-adders"><button type="button" class="cb-small" data-cb-action="open-picker" data-cb-part="if" data-cb-rule="${ruleIndex}" data-cb-path=""${full ? " disabled" : ""}>+ Condition</button>${[
        "all",
        "any",
        "not",
      ]
        .map(
          kind =>
            `<button type="button" class="cb-small cb-ghost" data-cb-action="add-group" data-cb-group="${kind}" data-cb-rule="${ruleIndex}" data-cb-path=""${full ? " disabled" : ""}>+ ${kind === "all" ? "All of" : kind === "any" ? "Any of" : "Not"}</button>`,
        )
        .join("")}</div>${picker}</section>`;
  }

  function doColumnHtml(model, rule, ruleIndex, errorMap) {
    const effects = Array.isArray(rule.do) ? rule.do : [];
    const when = model.when(rule.when?.block);
    const calc = when?.kind === "calc";
    const items = effects
      .map((ref, effectIndex) => {
        const def = model.effect(ref?.block);
        const target = { rule: ruleIndex, part: "do", path: String(effectIndex) };
        const messages = (errorMap.get(`do[${effectIndex}]`) || [])
          .map(message => `<p class="cb-error">${esc(friendly(model, message))}</p>`)
          .join("");
        const label = def ? upperFirst(model.describeEffect(ref)) : `Unknown effect "${ref?.block}"`;
        const badge =
          def && def.kind === "package"
            ? '<span class="cb-badge cb-badge-package" title="A single mechanic that cannot be split into smaller blocks.">Works as one piece</span>'
            : "";
        return `<div class="cb-effect" data-cb-node="do:${effectIndex}"><div class="cb-leaf-head"><span class="cb-step">${effectIndex === 0 ? "DO" : "THEN"}</span><b data-cb-label="do:${effectIndex}">${esc(label)}</b>${badge}<span class="cb-node-actions"><button type="button" class="icon cb-move" title="Move up" aria-label="Move this effect up" data-cb-action="effect-up" data-cb-rule="${ruleIndex}" data-cb-path="${effectIndex}"${effectIndex === 0 ? " disabled" : ""}>↑</button><button type="button" class="icon cb-move" title="Move down" aria-label="Move this effect down" data-cb-action="effect-down" data-cb-rule="${ruleIndex}" data-cb-path="${effectIndex}"${effectIndex >= effects.length - 1 ? " disabled" : ""}>↓</button><button type="button" class="icon danger" title="Remove" aria-label="Remove this effect" data-cb-action="remove-effect" data-cb-rule="${ruleIndex}" data-cb-path="${effectIndex}">×</button></span></div>${def ? paramsHtml(model, def, ref, target) : ""}${messages}</div>`;
      })
      .join("");
    const picker = ui.picker && ui.picker.rule === ruleIndex && ui.picker.part === "do" ? pickerHtml(model, rule) : "";
    const chanceErrors = (errorMap.get("chance") || [])
      .map(message => `<p class="cb-error">${esc(friendly(model, message))}</p>`)
      .join("");
    const full = effects.length >= LIMITS.effectsPerRule;
    return `<section class="cb-col cb-do" aria-label="DO"><h4 class="cb-col-title"><span class="as-builder-label do">DO</span></h4>
      <div class="cb-effects">${items || '<p class="cb-empty">Pick what should happen.</p>'}</div>
      <button type="button" class="cb-small" data-cb-action="open-picker" data-cb-part="do" data-cb-rule="${ruleIndex}"${full ? " disabled" : ""}>${effects.length === 0 ? "+ Effect" : "+ Then another effect"}</button>${picker}
      <label class="cb-chance"><span>Chance</span><input type="number" min="1" max="100" step="1" value="${esc(rule.chance)}" aria-label="Chance percent"${calc ? " disabled" : ""} data-cb-field="chance" data-cb-rule="${ruleIndex}"><b>%</b></label>${calc ? '<small class="cb-hint">Always 100% while the game is calculating: no dice can be rolled there.</small>' : ""}${chanceErrors}</section>`;
  }

  function ruleHtml(model, rule, ruleIndex, count, errors) {
    const errorMap = errorsByPart(errors, ruleIndex);
    const other = [...(errorMap.get("other") || []), ...(errorMap.get("key") || [])];
    return `<article class="cb-rule" data-cb-rule="${ruleIndex}" aria-label="Block rule ${ruleIndex + 1}">
      <header class="cb-rule-head"><span class="as-rule-number" aria-hidden="true">${ruleIndex + 1}</span><label class="cb-rule-name"><span>Rule name</span><input maxlength="48" value="${esc(rule.key)}" aria-label="Rule name" data-cb-field="key" data-cb-rule="${ruleIndex}"></label>
      <span class="cb-rule-actions"><button type="button" class="icon" title="Move rule up" aria-label="Move rule up" data-cb-action="rule-up" data-cb-rule="${ruleIndex}"${ruleIndex === 0 ? " disabled" : ""}>↑</button><button type="button" class="icon" title="Move rule down" aria-label="Move rule down" data-cb-action="rule-down" data-cb-rule="${ruleIndex}"${ruleIndex >= count - 1 ? " disabled" : ""}>↓</button><button type="button" class="icon danger" title="Remove rule" aria-label="Remove rule" data-cb-action="remove-rule" data-cb-rule="${ruleIndex}">×</button></span></header>
      <p class="cb-sentence" data-cb-sentence aria-live="polite">${esc(model.sentence(rule))}</p>
      <div class="cb-columns">${whenColumnHtml(model, rule, ruleIndex, errorMap)}${ifColumnHtml(model, rule, ruleIndex, errorMap)}${doColumnHtml(model, rule, ruleIndex, errorMap)}</div>
      <div class="cb-rule-errors" data-cb-rule-errors>${other.map(message => `<p class="cb-error">${esc(friendly(model, message))}</p>`).join("")}</div>
    </article>`;
  }

  // ---- picker ----

  function pickerPool(model, rule) {
    const picker = ui.picker;
    const whenId = picker.part === "new-rule" ? undefined : rule?.when?.block;
    if (picker.part === "when" || picker.part === "new-rule") {
      return { kind: "when", ...model.searchWhens(picker.query, picker.showAll) };
    }
    if (picker.part === "if") {
      return { kind: "if", ...model.searchConditions(picker.query, whenId, picker.showAll) };
    }
    return { kind: "do", ...model.searchEffects(picker.query, whenId, picker.showAll) };
  }

  function pickItemHtml(model, kind, entry) {
    if (kind === "when") {
      const { def, fit } = entry;
      return `<button type="button" role="option" class="cb-pick${fit.ok ? "" : " cb-pick-off"}" data-cb-action="pick" data-cb-block="${esc(def.id)}"${fit.ok ? "" : " disabled"}><span class="cb-pick-main"><b>${esc(def.label)}</b>${fit.ok ? (def.summary ? `<small>${esc(def.summary)}</small>` : "") : `<small>${esc(fit.reason)}</small>`}</span><span class="cb-pick-tags"><i>${esc(def.group)}</i></span></button>`;
    }
    const { def, fit } = entry;
    const label = upperFirst(model.renderLabel(def.label, model.defaultParams(def), def.params));
    const badge = def.kind === "package" ? '<span class="cb-badge cb-badge-package">Works as one piece</span>' : "";
    const tag =
      kind === "if"
        ? def.group
        : def.kind === "calc"
          ? "Changes a calculation"
          : def.kind === "package"
            ? "Whole mechanic"
            : "Event";
    return `<button type="button" role="option" class="cb-pick${fit.ok ? "" : " cb-pick-off"}" data-cb-action="pick" data-cb-block="${esc(def.id)}"${fit.ok ? "" : " disabled"}><span class="cb-pick-main"><b>${esc(label)}</b>${fit.ok ? (def.summary ? `<small>${esc(def.summary)}</small>` : def.examples[0] ? `<small>e.g. ${esc(def.examples[0])}</small>` : "") : `<small>${esc(fit.reason)}</small>`}</span><span class="cb-pick-tags">${badge}<i>${esc(tag)}</i></span></button>`;
  }

  function pickerListHtml(model, rule) {
    const picker = ui.picker;
    const pool = pickerPool(model, rule);
    const total = pool.results.length;
    const shown = pool.results.slice(0, picker.limit);
    let listHtml = "";
    if (pool.kind === "when") {
      for (const section of WHEN_SECTIONS) {
        const inSection = shown.filter(entry => entry.def.kind === section.kind);
        if (inSection.length === 0) {
          continue;
        }
        listHtml += `<div class="cb-pick-section" role="presentation"><h5>${esc(section.title)}</h5>`;
        if (picker.query.trim() === "") {
          const groups = [...new Set(inSection.map(entry => entry.def.group))];
          for (const group of groups) {
            listHtml += `<div class="cb-pick-group" role="presentation"><h6>${esc(group)}</h6>${inSection
              .filter(entry => entry.def.group === group)
              .map(entry => pickItemHtml(model, "when", entry))
              .join("")}</div>`;
          }
        } else {
          listHtml += inSection.map(entry => pickItemHtml(model, "when", entry)).join("");
        }
        listHtml += "</div>";
      }
    } else if (picker.query.trim() === "" && pool.kind === "if") {
      const groups = [...new Set(shown.map(entry => entry.def.group))];
      for (const group of groups) {
        listHtml += `<div class="cb-pick-group" role="presentation"><h6>${esc(group)}</h6>${shown
          .filter(entry => entry.def.group === group)
          .map(entry => pickItemHtml(model, "if", entry))
          .join("")}</div>`;
      }
    } else {
      listHtml = shown.map(entry => pickItemHtml(model, pool.kind, entry)).join("");
    }
    if (total === 0) {
      listHtml = `<p class="cb-empty">Nothing matches "${esc(picker.query)}". Try another word, like "damage", "HP" or "switch".</p>`;
    }
    const more =
      total > shown.length
        ? `<button type="button" class="cb-small" data-cb-action="picker-more">Show ${Math.min(PICKER_PAGE, total - shown.length)} more</button>`
        : "";
    const hiddenNote =
      pool.hidden > 0
        ? `<p class="cb-picker-foot">${picker.showAll ? "Greyed-out blocks cannot be used here." : pool.kind === "when" ? `${pool.hidden} more triggers are planned but not wired up yet.` : `${pool.hidden} more ${pool.hidden === 1 ? "block is" : "blocks are"} hidden because this trigger cannot provide what ${pool.hidden === 1 ? "it needs" : "they need"}.`} <button type="button" class="cb-link" data-cb-action="toggle-incompatible">${picker.showAll ? "Hide them" : "Show them"}</button></p>`
        : "";
    return `${listHtml}${more}${hiddenNote}`;
  }

  function pickerHtml(model, rule) {
    const picker = ui.picker;
    const noun = picker.part === "if" ? "a condition" : picker.part === "do" ? "an effect" : "a trigger";
    return `<div class="cb-picker" role="dialog" aria-label="Choose ${noun}" data-cb-picker><div class="cb-picker-head"><input type="search" class="cb-picker-search" role="combobox" aria-expanded="true" aria-controls="cb-picker-list" aria-autocomplete="list" autocomplete="off" placeholder="Search: ${picker.part === "do" ? "half damage, switch out, raise attack…" : picker.part === "if" ? "full HP, Fire move, weather…" : "enter battle, after I am hit…"}" value="${esc(picker.query)}" data-cb-search><button type="button" class="icon" aria-label="Close" data-cb-action="close-picker">×</button></div><div id="cb-picker-list" class="cb-picker-list" role="listbox" data-cb-picker-list>${pickerListHtml(model, rule)}</div></div>`;
  }

  // ---- the section ----

  function sectionHtml(model, entry, key, extra) {
    resetUi(key);
    const options = extra || {};
    if (!isUpgraded(entry)) {
      return `<section class="cb-section cb-upgrade" aria-label="Blocks"><div class="as-section-title"><h3>BLOCKS</h3></div><div class="cb-upgrade-body"><p><b>This ability uses the classic builder.</b> It keeps working exactly as it does now; nothing changes unless you upgrade it.</p><p class="muted">Upgrading adds the WHEN / IF / DO block builder next to your existing rules. Your current rules are not touched and the ability behaves the same until you add a block rule.</p><button type="button" class="primary" data-cb-action="upgrade">Upgrade to blocks</button></div></section>`;
    }
    const rules = entry.composition;
    const errors = model.validate(rules);
    const newRulePicker = ui.picker && ui.picker.part === "new-rule" ? pickerHtml(model, undefined) : "";
    const moveList =
      model.moveNames.length > 0
        ? `<datalist id="cb-move-names">${model.moveNames.map(name => `<option value="${esc(name)}"></option>`).join("")}</datalist>`
        : "";
    const stale = model.stale
      ? '<p class="cb-warning" role="alert">The block data in this editor is older than the game data. Regenerate it with the editor data tool before building new rules.</p>'
      : "";
    return `<section class="cb-section" aria-label="Block rules"><div class="as-section-title"><h3>BLOCK RULES</h3><span class="cb-count">${rules.length} ${rules.length === 1 ? "rule" : "rules"}</span><button type="button" class="primary cb-add-rule" data-cb-action="add-rule"${rules.length >= LIMITS.rules ? " disabled" : ""}>+ Add rule</button></div>${stale}${newRulePicker}
      <div class="cb-rules">${rules.length > 0 ? rules.map((rule, index) => ruleHtml(model, rule, index, rules.length, errors)).join("") : `<div class="cb-empty-state"><p><b>No block rules yet.</b></p><p class="muted">Each rule reads: WHEN something happens, IF these conditions hold, DO these effects. Press "Add rule" and search for a trigger such as "after I am hit".</p></div>`}</div>${moveList}${options.footer || ""}</section>`;
  }

  // ---- in-place refresh (typing must not lose focus) ----

  function refreshRuleInPlace(model, entry, ruleIndex, doc) {
    const rule = entry.composition?.[ruleIndex];
    const card = doc.querySelector(`.cb-rule[data-cb-rule="${ruleIndex}"]`);
    if (!rule || !card) {
      return;
    }
    const sentence = card.querySelector("[data-cb-sentence]");
    if (sentence) {
      sentence.textContent = model.sentence(rule);
    }
    card.querySelectorAll("[data-cb-label]").forEach(element => {
      const [part, path] = element.dataset.cbLabel.split(":");
      if (part === "if") {
        const node = nodeAt(rule.if || [], parsePath(path));
        if (node && !isGroup(node) && model.condition(node.block)) {
          element.textContent = upperFirst(model.describeCondition(node));
        }
      } else if (part === "do") {
        const ref = rule.do?.[Number(path)];
        if (ref && model.effect(ref.block)) {
          element.textContent = upperFirst(model.describeEffect(ref));
        }
      }
    });
    const errors = model.validate(entry.composition);
    const byPart = errorsByPart(errors, ruleIndex);
    card
      .querySelectorAll("[data-cb-node] > .cb-error, .cb-col > .cb-error, .cb-effect > .cb-error, .cb-leaf > .cb-error")
      .forEach(element => {
        element.remove();
      });
    // Re-add errors next to the block they belong to.
    for (const [part, messages] of byPart) {
      let host = null;
      const doMatch = /^do\[(\d+)\]/.exec(part);
      if (part === "when") {
        host = card.querySelector(".cb-when .cb-when-card");
      } else if (part === "chance") {
        host = card.querySelector(".cb-chance");
      } else if (doMatch) {
        host = card.querySelector(`[data-cb-node="do:${doMatch[1]}"] .cb-leaf-head`);
      } else if (part.startsWith("if[")) {
        const path = [];
        const re = /\[(\d+)\]/g;
        let match = re.exec(part);
        while (match) {
          path.push(Number(match[1]));
          match = re.exec(part);
        }
        host = card.querySelector(
          `[data-cb-node="${joinPath(path)}"] .cb-leaf-head, [data-cb-node="${joinPath(path)}"] .cb-group-head`,
        );
      }
      if (host && part !== "other" && part !== "key") {
        host.insertAdjacentHTML(
          "afterend",
          messages.map(message => `<p class="cb-error">${esc(friendly(model, message))}</p>`).join(""),
        );
      }
    }
    const rest = card.querySelector("[data-cb-rule-errors]");
    if (rest) {
      rest.innerHTML = [...(byPart.get("other") || []), ...(byPart.get("key") || [])]
        .map(message => `<p class="cb-error">${esc(friendly(model, message))}</p>`)
        .join("");
    }
  }

  // ---- event handling (the studio calls these; `ctx` = { model, entry, key, notify(render) }) ----

  function coerceParam(def, element) {
    switch (def.control) {
      case "boolean":
        return element.checked;
      case "number":
      case "slider": {
        if (element.value.trim() === "") {
          return Number.NaN;
        }
        return Number(element.value);
      }
      default:
        return element.value;
    }
  }

  function paramTarget(entry, element) {
    const rule = entry.composition?.[Number(element.dataset.cbRule)];
    if (!rule) {
      return;
    }
    if (element.dataset.cbTarget === "do") {
      return rule.do?.[Number(element.dataset.cbPath)];
    }
    return nodeAt(rule.if || [], parsePath(element.dataset.cbPath));
  }

  function handleInput(element, ctx) {
    const { model, entry } = ctx;
    if (element.hasAttribute("data-cb-group-type")) {
      return handleChange(element, ctx);
    }
    if (element.hasAttribute("data-cb-search")) {
      if (ui.picker) {
        ui.picker.query = element.value;
        ui.picker.limit = PICKER_PAGE;
        const list = element.closest("[data-cb-picker]")?.querySelector("[data-cb-picker-list]");
        const rule = entry.composition?.[ui.picker.rule];
        if (list) {
          list.innerHTML = pickerListHtml(model, rule);
        }
      }
      return true;
    }
    if (!element.hasAttribute("data-cb-param") && !element.hasAttribute("data-cb-field")) {
      return false;
    }
    const ruleIndex = Number(element.dataset.cbRule);
    const rule = entry.composition?.[ruleIndex];
    if (!rule) {
      return true;
    }
    if (element.hasAttribute("data-cb-field")) {
      if (element.dataset.cbField === "chance") {
        rule.chance = element.value.trim() === "" ? Number.NaN : Number(element.value);
      } else if (element.dataset.cbField === "key") {
        rule.key = element.value;
      }
      refreshRuleInPlace(model, entry, ruleIndex, element.ownerDocument);
      ctx.notify(false);
      return true;
    }
    const ref = paramTarget(entry, element);
    if (!ref) {
      return true;
    }
    const def = element.dataset.cbTarget === "do" ? model.effect(ref.block) : model.condition(ref.block);
    const param = def?.params.find(item => item.id === element.dataset.cbParam);
    if (!param) {
      return true;
    }
    ref.params = { ...(ref.params || {}), [param.id]: coerceParam(param, element) };
    const output = element.parentElement?.querySelector("[data-cb-output]");
    if (output) {
      output.textContent = formatOutput(param, ref.params[param.id]);
    }
    refreshRuleInPlace(model, entry, ruleIndex, element.ownerDocument);
    ctx.notify(false);
    return true;
  }

  function openPicker(part, ruleIndex, path) {
    ui.picker = { rule: ruleIndex, part, path: path || "", query: "", showAll: false, limit: PICKER_PAGE };
  }

  function pick(model, entry, blockId) {
    const picker = ui.picker;
    if (!picker) {
      return false;
    }
    if (picker.part === "new-rule") {
      entry.composition ||= [];
      if (entry.composition.length >= LIMITS.rules) {
        return false;
      }
      entry.composition.push(newRule(entry.composition, blockId));
      const index = entry.composition.length - 1;
      openPicker("do", index);
      return true;
    }
    const rule = entry.composition?.[picker.rule];
    if (!rule) {
      return false;
    }
    if (picker.part === "when") {
      rule.when = { block: blockId };
      if (model.when(blockId)?.kind === "calc") {
        rule.chance = 100;
      }
      ui.picker = null;
      return true;
    }
    if (picker.part === "if") {
      const def = model.condition(blockId);
      if (!def) {
        return false;
      }
      const node = { block: blockId, ...(def.params.length > 0 ? { params: model.defaultParams(def) } : {}) };
      const added = addCondition(rule, parsePath(picker.path), node);
      ui.picker = null;
      return added;
    }
    const def = model.effect(blockId);
    if (!def || rule.do.length >= LIMITS.effectsPerRule) {
      return false;
    }
    rule.do.push({ block: blockId, ...(def.params.length > 0 ? { params: model.defaultParams(def) } : {}) });
    ui.picker = null;
    return true;
  }

  function handleClick(event, ctx) {
    const button = event.target.closest?.("[data-cb-action]");
    const { model, entry } = ctx;
    if (!button) {
      return false;
    }
    const action = button.dataset.cbAction;
    const ruleIndex = Number(button.dataset.cbRule);
    const rule = entry.composition?.[ruleIndex];
    switch (action) {
      case "upgrade":
        upgradeEntry(entry);
        break;
      case "add-rule":
        openPicker("new-rule", -1);
        break;
      case "open-picker":
        openPicker(button.dataset.cbPart, ruleIndex, button.dataset.cbPath);
        break;
      case "close-picker":
        ui.picker = null;
        break;
      case "toggle-incompatible":
        if (ui.picker) {
          ui.picker.showAll = !ui.picker.showAll;
        }
        break;
      case "picker-more":
        if (ui.picker) {
          ui.picker.limit += PICKER_PAGE;
        }
        break;
      case "pick":
        if (!pick(model, entry, button.dataset.cbBlock)) {
          return true;
        }
        break;
      case "toggle-info": {
        const infoKey = button.dataset.cbInfo;
        if (ui.info.has(infoKey)) {
          ui.info.delete(infoKey);
        } else {
          ui.info.add(infoKey);
        }
        break;
      }
      case "remove-rule":
        entry.composition.splice(ruleIndex, 1);
        ui.picker = null;
        break;
      case "rule-up":
      case "rule-down":
        swapIn(entry.composition, ruleIndex, action === "rule-up" ? -1 : 1);
        break;
      case "add-group":
        if (rule) {
          addCondition(rule, parsePath(button.dataset.cbPath), newGroup(button.dataset.cbGroup));
        }
        break;
      case "remove-node":
        if (rule) {
          removeCondition(rule, parsePath(button.dataset.cbPath));
        }
        break;
      case "node-up":
      case "node-down":
        if (rule) {
          moveCondition(rule, parsePath(button.dataset.cbPath), action === "node-up" ? -1 : 1);
        }
        break;
      case "remove-effect":
        if (rule) {
          rule.do.splice(Number(button.dataset.cbPath), 1);
        }
        break;
      case "effect-up":
      case "effect-down":
        if (rule) {
          swapIn(rule.do, Number(button.dataset.cbPath), action === "effect-up" ? -1 : 1);
        }
        break;
      case "toggle-classic":
        if (ui.classicOpen.has(ctx.key)) {
          ui.classicOpen.delete(ctx.key);
        } else {
          ui.classicOpen.add(ctx.key);
        }
        break;
      default:
        return false;
    }
    ctx.notify(true);
    return true;
  }

  function handleChange(element, ctx) {
    if (!element.hasAttribute("data-cb-group-type")) {
      return false;
    }
    const rule = ctx.entry.composition?.[Number(element.dataset.cbRule)];
    if (rule) {
      setGroupKind(rule, parsePath(element.dataset.cbPath), element.value);
    }
    ctx.notify(true);
    return true;
  }

  /** Escape closes an open picker; Enter in the search box picks the first usable result; arrows walk the list. */
  function handleKeyDown(event, ctx) {
    const target = event.target;
    if (!ui.picker || !target.closest?.("[data-cb-picker]")) {
      return false;
    }
    if (event.key === "Escape") {
      ui.picker = null;
      ctx.notify(true);
      return true;
    }
    const picker = target.closest("[data-cb-picker]");
    const options = [...picker.querySelectorAll(".cb-pick:not([disabled])")];
    if (event.key === "Enter" && target.hasAttribute("data-cb-search")) {
      event.preventDefault();
      if (options[0] && pick(ctx.model, ctx.entry, options[0].dataset.cbBlock)) {
        ctx.notify(true);
      }
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const current = options.indexOf(target);
      const next = event.key === "ArrowDown" ? current + 1 : current - 1;
      if (next >= 0 && options[next]) {
        event.preventDefault();
        options[next].focus();
      } else if (next < 0) {
        event.preventDefault();
        picker.querySelector("[data-cb-search]")?.focus();
      }
      return true;
    }
    return false;
  }

  function afterRender(root) {
    if (ui.picker) {
      const search = root.querySelector("[data-cb-picker] [data-cb-search]");
      search?.focus();
      if (search) {
        const end = search.value.length;
        search.setSelectionRange?.(end, end);
      }
    }
  }

  /** Plain-language problems of the entry's block rules, ready for the studio's validation list. */
  function entryErrors(model, entry) {
    if (!isUpgraded(entry)) {
      return [];
    }
    return model.validate(entry.composition).map(message => {
      const match = /^composition\[(\d+)\]/.exec(message);
      const text = friendly(model, message).replace(/^composition /, "");
      return match ? `Block rule ${Number(match[1]) + 1}: ${text}` : `Block rules ${text}`;
    });
  }

  /** One plain sentence per block rule, for the mechanics summary. */
  function summaryLines(model, entry) {
    return isUpgraded(entry) ? entry.composition.map(rule => model.sentence(rule)) : [];
  }

  const isClassicOpen = key => ui.classicOpen.has(key);
  const isPickerOpen = () => ui.picker !== null;
  const closePicker = () => {
    ui.picker = null;
  };

  return {
    LIMITS,
    createModel,
    sectionHtml,
    badgeHtml,
    handleClick,
    handleChange,
    handleInput,
    handleKeyDown,
    afterRender,
    refreshRuleInPlace,
    entryErrors,
    summaryLines,
    isClassicOpen,
    isPickerOpen,
    closePicker,
    upgradeEntry,
    isUpgraded,
    // pure helpers, exposed for tests
    validateParamValues,
    conditionRequires,
    defaultParams,
    parsePath,
    nodeAt,
    addCondition,
    removeCondition,
    moveCondition,
    setGroupKind,
    newGroup,
    isGroup,
    groupKind,
    childrenOf,
    esc,
    pretty,
  };
});
