(() => {
  const API = "https://er-save-api.heraklines.workers.dev";
  const EDITOR_API = "https://er-editor-api.heraklines.workers.dev";
  const STAGED_KEY = "er-editor-staged-community-suggestions";
  const IGNORED_KEY = "er-editor-ignored-suggestion-authors";
  const DEMO_QUEUE_KEY = "er-community-editor-demo-suggestions";
  const DEMO_REVIEW_KEY = "er-community-editor-demo-reviews-v3";
  const demo = new URLSearchParams(location.search).has("suggestion-demo");
  const FILE_TABS = {
    "egg-moves": "eggmoves",
    "species-tuning": "species",
    learnsets: "learnsets",
    "tm-learnsets": "tms",
    "species-abilities": "abilities",
    "item-tuning": "items",
    "balance-tuning": "game",
    "custom-trainers": "customtrainers",
    "custom-trainers-config": "customtrainers",
  };
  const TAB_LABELS = {
    eggmoves: "Egg Moves",
    species: "Species",
    learnsets: "Learnsets",
    tms: "TMs",
    abilities: "Abilities",
    items: "Items",
    game: "Game",
    customtrainers: "Custom Trainers",
  };
  const FIELD_LABELS = {
    eggTier: "Egg tier",
    cost: "Starter cost",
    tier: "Rarity tier",
    weight: "Reward weight",
    maxStack: "Maximum stack",
    ability1: "Ability 1",
    ability2: "Ability 2",
    hidden: "Hidden Ability",
    innates: "Innates",
    name: "Name",
    trainerClass: "Battle class",
    trainerSprite: "Uploaded art",
    gender: "Gender",
    battleType: "Battle type",
    difficulties: "Difficulties",
    minWave: "Minimum wave",
    maxWave: "Maximum wave",
    endless: "Endless eligibility",
    challenge: "Challenge",
    challengeValue: "Challenge value",
    battleBgm: "Battle music",
    introDialogue: "Intro line",
    victoryDialogue: "Defeated line",
    defeatDialogue: "Victory line",
    trainerEffect: "Sprite effect",
    team: "Team",
    windowSize: "Spawn window",
    windowChancePct: "Chance per window",
  };
  const esc = value =>
    String(value ?? "").replace(
      /[&<>"']/g,
      char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
    );
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  let items = [];
  let loaded = false;
  let loading = false;
  let error = "";
  let reviewErrorId = "";
  const pendingReviews = new Set();
  let aggregateRoot = null;
  let selectedId = "";
  let revealId = "";
  let status = "open";
  let query = "";
  let showIgnored = false;
  const ignored = new Set(JSON.parse(localStorage.getItem(IGNORED_KEY) || "[]"));
  const appliedStaged = new Set();
  let staged = JSON.parse(localStorage.getItem(STAGED_KEY) || "[]");
  if (demo) {
    staged = staged.filter(item => item.sourceRevision !== "demo" || item.demoRevision === 3);
    localStorage.setItem(STAGED_KEY, JSON.stringify(staged));
  }

  const bridge = () => window.erAppBridge;
  const password = () => (document.querySelector("#password")?.value || "").trim();
  const persistStaged = () => localStorage.setItem(STAGED_KEY, JSON.stringify(staged));
  const titleCase = value =>
    String(value || "")
      .replace(/^SPECIES_/, "")
      .replace(/[_:.]+/g, " ")
      .replace(/\b\w/g, char => char.toUpperCase());

  function localDemoItems() {
    try {
      const value = JSON.parse(localStorage.getItem(DEMO_QUEUE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function demoReviews() {
    try {
      return JSON.parse(localStorage.getItem(DEMO_REVIEW_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function persistDemoReview(item, nextStatus) {
    const reviews = demoReviews();
    reviews[item.id] = nextStatus;
    localStorage.setItem(DEMO_REVIEW_KEY, JSON.stringify(reviews));
    const queue = localDemoItems();
    const queued = queue.find(entry => entry.id === item.id);
    if (queued) {
      queued.status = nextStatus;
      localStorage.setItem(DEMO_QUEUE_KEY, JSON.stringify(queue));
    }
  }

  function demoAuthor(name, offset, extra = {}) {
    return {
      author: name,
      status: "open",
      createdAt: Date.now() - offset,
      sourceRevision: "demo",
      demoRevision: 3,
      authorSuggestionCount: 7,
      authorAppliedCount: 3,
      authorStats: {
        achievementPoints: 8425,
        sessionsWon: 31,
        ribbons: 184,
        shinySpecies: 126,
        highestDamage: 41872,
        uniqueRelics: 17,
      },
      ...extra,
    };
  }

  function builtInDemoItems() {
    const catalogs = bridge()?.catalogs?.() || {};
    const species = catalogs.SPECIES || [];
    const moves = catalogs.MOVES_RICH || [];
    const abilities = catalogs.ABILS_RICH || [];
    const trainers = bridge()?.trainers?.() || [];
    const targetSpecies =
      species.find(entry => entry.const === "SPECIES_ZYGARDE")
      || [...species].sort((a, b) => String(b.name).localeCompare(String(a.name)))[0]
      || species[0];
    const second = species.find(entry => entry.const !== targetSpecies?.const) || targetSpecies;
    const item = (catalogs.ITEMS || []).find(entry => entry.key === "ER_LUCKY_HEART") || catalogs.ITEMS?.[0];
    const knob = (catalogs.KNOBS || []).find(entry => entry.kind === "scalar") || catalogs.KNOBS?.[0];
    const namedMove = (...names) => moves.find(entry => names.includes(entry.name)) || moves[0];
    const namedAbility = (...names) => abilities.find(entry => names.includes(entry.name)) || abilities[0];
    const trainer = trainers[0];
    const currentTrainer = trainer ? bridge()?.currentValue?.("custom-trainers", trainer.key) : null;
    const speciesId = Number(targetSpecies?.id) || 1;
    const rows = [];
    if (targetSpecies) {
      const eggBefore = bridge()?.currentValue?.("egg-moves", targetSpecies.const) || [];
      const eggFirst = [...eggBefore];
      const eggSecond = [...eggBefore];
      const eggReplacement = eggBefore[1] === "EXPANDING_FORCE" ? "MOONBLAST" : "EXPANDING_FORCE";
      const fourthReplacement = eggBefore[3] === "MOONBLAST" ? "PSYSTRIKE" : "MOONBLAST";
      eggFirst[1] = eggReplacement;
      eggSecond[3] = fourthReplacement;

      const speciesBefore = bridge()?.currentValue?.("species-tuning", targetSpecies.const) || { cost: 3, eggTier: 0 };
      const speciesAfter = {
        ...speciesBefore,
        cost: Math.max(1, Number(speciesBefore.cost || 1) + 1),
        eggTier: Math.min(3, Number(speciesBefore.eggTier || 0) + 1),
      };

      const learnBefore = bridge()?.currentValue?.("learnsets", targetSpecies.const) || [];
      const learnAfter = clone(learnBefore);
      const learnIndex = learnAfter.findIndex(entry => Number(entry?.[0]) > 1);
      if (learnIndex >= 0) {
        learnAfter[learnIndex][0] = Math.max(1, Number(learnAfter[learnIndex][0]) - 6);
      } else {
        learnAfter.push([18, namedMove("Psyshock", "Psychic")?.id || 1]);
      }

      const tmBefore = bridge()?.currentValue?.("tm-learnsets", targetSpecies.const) || [];
      const tmCandidate =
        moves.find(
          entry => !tmBefore.includes(entry.id) && ["Psyshock", "Mystical Fire", "Aura Sphere"].includes(entry.name),
        ) || moves.find(entry => !tmBefore.includes(entry.id));
      const tmAfter = tmCandidate ? [...tmBefore, tmCandidate.id] : [...tmBefore];

      const abilityBefore = bridge()?.currentValue?.("species-abilities", targetSpecies.const) || {};
      const occupied = new Set([
        abilityBefore.ability1,
        abilityBefore.ability2,
        abilityBefore.hidden,
        ...(abilityBefore.innates || []),
      ]);
      const abilityCandidate =
        [namedAbility("Trace"), namedAbility("Magic Guard"), namedAbility("Synchronize")].find(
          entry => entry && !occupied.has(entry.id),
        ) || abilities.find(entry => !occupied.has(entry.id));
      const abilityAfter = { ...clone(abilityBefore), ability2: abilityCandidate?.id || abilityBefore.ability2 };

      rows.push(
        {
          id: "sample-egg-zygarde",
          entityType: "pokemon",
          entityKey: targetSpecies.const,
          entityLabel: targetSpecies.name,
          reason: "Gives this starter a more useful early utility option without raising its damage ceiling.",
          changes: { "egg-moves": { [targetSpecies.const]: eggFirst } },
          baseline: { "egg-moves": { [targetSpecies.const]: eggBefore } },
          ...demoAuthor("UmbraKai", 3600000),
        },
        {
          id: "sample-egg-zygarde-two",
          entityType: "pokemon",
          entityKey: targetSpecies.const,
          entityLabel: targetSpecies.name,
          reason: "An alternate fourth slot proposal for players testing special wall matchups.",
          changes: { "egg-moves": { [targetSpecies.const]: eggSecond } },
          baseline: { "egg-moves": { [targetSpecies.const]: eggBefore } },
          ...demoAuthor("Sable", 4200000),
        },
        {
          id: "sample-species-zygarde",
          entityType: "pokemon",
          entityKey: targetSpecies.const,
          entityLabel: targetSpecies.name,
          reason: "The current cost underrates how consistently this line converts its early utility into a clear.",
          changes: { "species-tuning": { [targetSpecies.const]: speciesAfter } },
          baseline: { "species-tuning": { [targetSpecies.const]: speciesBefore } },
          ...demoAuthor("BalanceNerd", 5200000),
        },
        {
          id: "sample-learnset-zygarde",
          entityType: "pokemon",
          entityKey: targetSpecies.const,
          entityLabel: targetSpecies.name,
          reason: "Moves the reliable STAB option earlier so the line is not dependent on one reward roll.",
          changes: { learnsets: { [targetSpecies.const]: learnAfter } },
          baseline: { learnsets: { [targetSpecies.const]: learnBefore } },
          ...demoAuthor("UmbraKai", 6200000),
        },
        {
          id: "sample-tm-zygarde",
          entityType: "pokemon",
          entityKey: targetSpecies.const,
          entityLabel: targetSpecies.name,
          reason: "Adds one coverage option that already matches the line's intended special-attacker role.",
          changes: { "tm-learnsets": { [targetSpecies.const]: tmAfter } },
          baseline: { "tm-learnsets": { [targetSpecies.const]: tmBefore } },
          ...demoAuthor("LeafG", 7200000),
        },
        {
          id: "sample-abilities-zygarde",
          entityType: "pokemon",
          entityKey: targetSpecies.const,
          entityLabel: targetSpecies.name,
          reason: "The proposed choice ability creates a distinct support line while leaving the innates unchanged.",
          changes: { "species-abilities": { [targetSpecies.const]: abilityAfter } },
          baseline: { "species-abilities": { [targetSpecies.const]: abilityBefore } },
          ...demoAuthor("CyrusT", 8200000),
        },
      );
    }
    if (item) {
      const itemBefore = bridge()?.currentValue?.("item-tuning", item.key) || {};
      const itemAfter = {
        ...itemBefore,
        tier: itemBefore.tier === "ROGUE" ? "ULTRA" : "ROGUE",
        weight: Math.max(1, Number(itemBefore.weight || 5) - 1),
        maxStack: Math.max(1, Number(itemBefore.maxStack || 2) - 1),
      };
      rows.push({
        id: "sample-item",
        entityType: "item",
        entityKey: item.key,
        entityLabel: bridge()?.itemLabel?.(item.key) || titleCase(item.key),
        reason: "The current cap crowds out more interesting Rogue rewards after the first copy.",
        changes: { "item-tuning": { [item.key]: itemAfter } },
        baseline: { "item-tuning": { [item.key]: itemBefore } },
        ...demoAuthor("Sable", 9200000),
      });
    }
    if (knob) {
      const current = bridge()?.currentValue?.("balance-tuning", knob.key);
      const before = typeof current === "number" ? current : typeof knob.default === "number" ? knob.default : 1;
      rows.push({
        id: "sample-game",
        entityType: "game",
        entityKey: knob.key,
        entityLabel: knob.label,
        reason: "This keeps the reward curve aligned with the longer run length without changing encounter difficulty.",
        changes: { "balance-tuning": { [knob.key]: before + 0.25 } },
        baseline: { "balance-tuning": { [knob.key]: before } },
        ...demoAuthor("BalanceNerd", 10200000),
      });
    }
    if (trainer && currentTrainer) {
      rows.push({
        id: "sample-trainer-edit",
        entityType: "trainer",
        entityKey: trainer.key,
        entityLabel: trainer.name,
        reason: "The narrower wave range makes this team appear after its intended answers enter the reward pool.",
        changes: {
          "custom-trainers": {
            [trainer.key]: { ...currentTrainer, minWave: Math.max(20, Number(currentTrainer.minWave || 1) + 10) },
          },
        },
        baseline: { "custom-trainers": { [trainer.key]: currentTrainer } },
        ...demoAuthor("UmbraKai", 11200000),
      });
    }
    if (second) {
      rows.push({
        id: "sample-trainer-new",
        entityType: "trainer",
        entityKey: "COMMUNITY_NEW_TRAINER",
        entityLabel: "Nyx, Rift Researcher",
        reason:
          "A late-game doubles trainer built around weather denial and pivoting, with clear dialogue and a focused roster.",
        changes: {
          "custom-trainers": {
            COMMUNITY_NEW_TRAINER: {
              id: 9999,
              name: "Nyx, Rift Researcher",
              trainerClass: "SCIENTIST",
              battleType: "double",
              difficulties: ["elite", "hell"],
              minWave: 90,
              maxWave: 180,
              weight: 80,
              challenge: "none",
              introDialogue: "Every anomaly leaves a pattern. Yours ends here.",
              victoryDialogue: "The result was outside my model.",
              defeatDialogue: "Predictable.",
              team: [
                {
                  species: Number(second.id) || speciesId,
                  abilitySlot: 0,
                  moves: ["PROTECT", "TAILWIND"],
                  heldItems: [{ item: "LEFTOVERS", count: 1 }],
                },
                { species: speciesId, abilitySlot: 1, moves: ["PSYCHIC", "RECOVER"] },
              ],
            },
          },
        },
        baseline: { "custom-trainers": { COMMUNITY_NEW_TRAINER: null } },
        ...demoAuthor("LeafG", 12200000),
      });
    }
    return rows;
  }

  function contexts(item) {
    const result = [];
    for (const [file, delta] of Object.entries(item.changes || {})) {
      const tab = FILE_TABS[file];
      if (!tab || !delta || typeof delta !== "object") {
        continue;
      }
      if (file === "custom-trainers-config") {
        result.push({ tab, file, key: "__config", kind: "config" });
        continue;
      }
      for (const key of Object.keys(delta)) {
        result.push({
          tab,
          file,
          key,
          kind: file === "custom-trainers" ? "trainer" : tab === "game" ? "knob" : "entity",
        });
      }
    }
    return result;
  }

  function contextValue(item, context, side) {
    const source = side === "before" ? item.baseline : item.changes;
    const value = source?.[context.file];
    return context.key === "__config" ? value : value?.[context.key];
  }

  const openItems = () => items.filter(item => item.status === "open");
  const itemsFor = (tab, key) =>
    openItems().filter(item => contexts(item).some(context => context.tab === tab && context.key === key));
  const firstContext = (item, preferredTab = "") =>
    contexts(item).find(context => context.tab === preferredTab) || contexts(item)[0] || null;

  function visibleItems() {
    const needle = query.trim().toLowerCase();
    return items.filter(item => {
      if (status !== "all" && item.status !== status) {
        return false;
      }
      if (!showIgnored && ignored.has(item.author)) {
        return false;
      }
      const hay = `${item.entityLabel} ${item.entityKey} ${item.author} ${item.reason} ${contexts(item)
        .map(context => TAB_LABELS[context.tab])
        .join(" ")}`.toLowerCase();
      return !needle || hay.includes(needle);
    });
  }

  async function staffRequest(path, body) {
    if (demo) {
      return { ok: true };
    }
    const approval = path === "/community/editor-suggestions/staff/review" && body.action === "approve";
    if (!approval && !password()) {
      document.querySelector("#password")?.focus();
      throw new Error("Enter the editor password at the top, then retry the review.");
    }
    const response = await fetch(approval ? `${EDITOR_API}/suggestions/approve` : `${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(approval ? { id: body.id } : { password: password(), ...body }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }

  async function suggestionListRequest() {
    const response = await fetch(`${API}/community/editor-suggestions/staff/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "all" }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }

  async function load(force = false) {
    if (loading || (loaded && !force)) {
      return;
    }
    loading = true;
    error = "";
    drawAggregate();
    try {
      items = demo ? [...localDemoItems(), ...builtInDemoItems()] : (await suggestionListRequest()).items || [];
      if (demo) {
        const reviews = demoReviews();
        items.forEach(item => {
          if (reviews[item.id]) {
            item.status = reviews[item.id];
          }
        });
      }
      loaded = true;
      staged.forEach(item => {
        if (!appliedStaged.has(item.id)) {
          bridge()?.applyChanges?.(item.changes);
          appliedStaged.add(item.id);
        }
      });
      if (!items.some(item => item.id === selectedId)) {
        selectedId = visibleItems()[0]?.id || "";
      }
    } catch (cause) {
      error = cause.message;
      items = [];
      loaded = true;
    } finally {
      loading = false;
      syncNavBadges();
      if (bridge()?.activeTab?.() === "suggestions") {
        drawAggregate();
      } else {
        bridge()?.render?.();
      }
    }
  }

  const tabCount = tab => openItems().filter(item => contexts(item).some(context => context.tab === tab)).length;

  function activateBadge(element, handler) {
    element.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      handler();
    });
    element.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handler();
      }
    });
  }

  function syncNavBadges() {
    for (const tab of Object.keys(TAB_LABELS)) {
      const button = document.querySelector(`nav.tabs [data-tab="${tab}"]`);
      if (!button) {
        continue;
      }
      button.querySelector("[data-sug-badge]")?.remove();
      const count = tabCount(tab);
      if (!count) {
        continue;
      }
      const badge = document.createElement("span");
      badge.dataset.sugBadge = tab;
      badge.setAttribute("role", "button");
      badge.tabIndex = 0;
      badge.title = `${count} open suggestion${count === 1 ? "" : "s"}. Review first.`;
      badge.textContent = String(count);
      activateBadge(badge, () => {
        const item = openItems().find(entry => contexts(entry).some(context => context.tab === tab));
        if (item) {
          navigateTo(item.id, tab);
        }
      });
      button.appendChild(badge);
    }
    const total = openItems().length;
    const aggregate = document.querySelector("#suggestion-nav-count");
    if (aggregate) {
      aggregate.className = total ? "suggestion-count" : "";
      aggregate.textContent = total ? String(total) : "";
    }
  }

  function entityBadge(tab, key, relevant) {
    const badge = document.createElement("span");
    badge.className = "sug-ent";
    badge.setAttribute("role", "button");
    badge.tabIndex = 0;
    badge.textContent = String(relevant.length);
    badge.title = `${relevant.length} open suggestion${relevant.length === 1 ? "" : "s"}`;
    activateBadge(badge, () => navigateTo(relevant[0].id, tab, key));
    return badge;
  }

  function moveName(value) {
    return typeof value === "number" ? bridge()?.moveLabel?.(value) || `Move ${value}` : titleCase(value);
  }
  function abilityName(value) {
    return value ? bridge()?.abilityLabel?.(value) || `Ability ${value}` : "None";
  }
  function speciesName(value) {
    return typeof value === "number"
      ? bridge()?.speciesById?.(value)?.name || `Species ${value}`
      : bridge()?.speciesLabel?.(value) || titleCase(value);
  }

  function fieldLabel(path, context) {
    const leaf = path.split(".").pop();
    if (context.tab === "game" && path === "") {
      return bridge()?.knob?.(context.key)?.label || titleCase(context.key);
    }
    if (path === "") {
      if (context.file === "egg-moves") {
        return "Egg moves";
      }
      if (context.file === "learnsets") {
        return "Level-up learnset";
      }
      if (context.file === "tm-learnsets") {
        return "TM pool";
      }
      if (context.file === "species-abilities") {
        return "Abilities";
      }
      if (context.file === "custom-trainers") {
        return "Trainer";
      }
    }
    if (/^innates\.\d+$/.test(path)) {
      return `Innate ${Number(leaf) + 1}`;
    }
    return FIELD_LABELS[leaf] || titleCase(leaf || context.key);
  }

  function trainerMember(member) {
    if (!member || typeof member !== "object") {
      return {};
    }
    return Array.isArray(member.variants) && member.variants.length > 0 ? member.variants[0] || {} : member;
  }
  function trainerMemberName(member) {
    const value = trainerMember(member);
    const base = speciesName(value.species);
    return Array.isArray(member?.variants) && member.variants.length > 1
      ? `${base} (+${member.variants.length - 1} variants)`
      : base;
  }

  function formatValue(value, path, context) {
    if (value === undefined || value === null || value === "") {
      return "-";
    }
    if (context.file === "egg-moves") {
      return Array.isArray(value) ? value.map(moveName).join(", ") : moveName(value);
    }
    if (context.file === "learnsets" && Array.isArray(value)) {
      return value.map(entry => `Lv. ${entry[0]} ${moveName(entry[1])}`).join("; ");
    }
    if (context.file === "tm-learnsets" && Array.isArray(value)) {
      return value.map(moveName).join(", ");
    }
    if (context.file === "species-abilities") {
      if (Array.isArray(value)) {
        return value.map(abilityName).join(", ");
      }
      if (path.includes("ability") || path.includes("innate")) {
        return abilityName(value);
      }
    }
    if (path.endsWith("eggTier") && Number.isFinite(Number(value))) {
      return bridge()?.catalogs?.().EGG_TIER_NAMES?.[Number(value)] || String(value);
    }
    if (path.endsWith("trainerClass")) {
      return bridge()?.classLabel?.(value) || titleCase(value);
    }
    if (path.endsWith("trainerSprite")) {
      return bridge()?.spriteLabel?.(value) || titleCase(value);
    }
    if (path.endsWith("battleBgm")) {
      return bridge()?.bgmLabel?.(value) || titleCase(value);
    }
    if (path.endsWith("trainerEffect")) {
      return bridge()?.fxLabel?.(value) || titleCase(value);
    }
    if (path.endsWith("difficulties") && Array.isArray(value)) {
      return value.map(titleCase).join(", ");
    }
    if (path.endsWith("team") && Array.isArray(value)) {
      return value.map(member => trainerMemberName(member)).join(", ");
    }
    if (Array.isArray(value)) {
      return value
        .map(entry => (typeof entry === "object" ? titleCase(entry?.name || "entry") : String(entry)))
        .join(", ");
    }
    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }
    if (typeof value === "object") {
      return Object.entries(value)
        .map(([key, entry]) => `${titleCase(key)}: ${formatValue(entry, `${path}.${key}`, context)}`)
        .join("; ");
    }
    return String(value);
  }

  function diffRows(before, after, context, path = "") {
    if (equal(before, after)) {
      return [];
    }
    if (path === "" && context.file === "egg-moves" && Array.isArray(before) && Array.isArray(after)) {
      const rows = [];
      const length = Math.max(before.length, after.length);
      for (let index = 0; index < length; index += 1) {
        if (!equal(before[index], after[index])) {
          rows.push({
            label: `Egg Move ${index + 1}`,
            before: formatValue(before[index], `${index}`, context),
            after: formatValue(after[index], `${index}`, context),
          });
        }
      }
      return rows;
    }
    if (path === "" && context.file === "learnsets" && Array.isArray(before) && Array.isArray(after)) {
      const rows = [];
      const previous = new Map(before.map(entry => [entry[1], entry[0]]));
      const proposed = new Map(after.map(entry => [entry[1], entry[0]]));
      for (const move of new Set([...previous.keys(), ...proposed.keys()])) {
        const oldLevel = previous.get(move);
        const newLevel = proposed.get(move);
        if (oldLevel === newLevel) {
          continue;
        }
        rows.push({
          label: moveName(move),
          before: oldLevel === undefined ? "-" : `Lv. ${oldLevel}`,
          after: newLevel === undefined ? "-" : `Lv. ${newLevel}`,
        });
      }
      return rows;
    }
    if (path === "" && context.file === "tm-learnsets" && Array.isArray(before) && Array.isArray(after)) {
      const rows = [];
      for (const move of before.filter(value => !after.includes(value))) {
        rows.push({ label: "TM removal", before: moveName(move), after: "-" });
      }
      for (const move of after.filter(value => !before.includes(value))) {
        rows.push({ label: "TM addition", before: "-", after: moveName(move) });
      }
      return rows;
    }
    if (context.file === "species-abilities" && path === "innates" && Array.isArray(before) && Array.isArray(after)) {
      const rows = [];
      const length = Math.max(before.length, after.length);
      for (let index = 0; index < length; index += 1) {
        if (!equal(before[index], after[index])) {
          rows.push({
            label: `Innate ${index + 1}`,
            before: abilityName(before[index]),
            after: abilityName(after[index]),
          });
        }
      }
      return rows;
    }
    if (
      before
      && after
      && typeof before === "object"
      && typeof after === "object"
      && !Array.isArray(before)
      && !Array.isArray(after)
    ) {
      const rows = [];
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        rows.push(...diffRows(before[key], after[key], context, path ? `${path}.${key}` : key));
      }
      return rows;
    }
    return [
      {
        label: fieldLabel(path, context),
        before: formatValue(before, path, context),
        after: formatValue(after, path, context),
      },
    ];
  }

  function trainerTeamHtml(team) {
    if (!Array.isArray(team) || team.length === 0) {
      return '<span class="sug-note">No team members.</span>';
    }
    return `<ol>${team
      .map(member => {
        const value = trainerMember(member);
        const moves = (value.moves || []).map(moveName).join(", ") || "Default moves";
        const held = (value.heldItems || [])
          .map(
            entry =>
              `${bridge()?.heldItemLabel?.(entry.item) || titleCase(entry.item)}${entry.count > 1 ? ` x${entry.count}` : ""}`,
          )
          .join(", ");
        return `<li><strong>${esc(trainerMemberName(member))}</strong> - ${esc(moves)}${held ? ` - ${esc(held)}` : ""}</li>`;
      })
      .join("")}</ol>`;
  }

  function trainerPreviewHtml(value) {
    if (!value || typeof value !== "object") {
      return '<div class="sug-note">Trainer removed.</div>';
    }
    const wave = value.endless
      ? `${value.minWave || 1}+`
      : `${value.minWave || 1}-${value.maxWave || value.minWave || 1}`;
    return `<div class="sug-preview"><div><h4>Identity</h4><div class="kv"><strong>${esc(value.name || "Unnamed trainer")}</strong></div><div class="kv"><b>Class:</b> ${esc(bridge()?.classLabel?.(value.trainerClass) || titleCase(value.trainerClass))}</div>${value.trainerSprite ? `<div class="kv"><b>Art:</b> ${esc(bridge()?.spriteLabel?.(value.trainerSprite) || titleCase(value.trainerSprite))}</div>` : ""}</div><div><h4>Spawn rules</h4><div class="kv"><b>Battle:</b> ${esc(titleCase(value.battleType || "single"))}</div><div class="kv"><b>Waves:</b> ${esc(wave)}</div><div class="kv"><b>Difficulty:</b> ${esc((value.difficulties || []).map(titleCase).join(", ") || "Any")}</div></div><div class="full"><h4>Team</h4>${trainerTeamHtml(value.team)}</div><div class="full"><h4>Dialogue and presentation</h4>${value.introDialogue ? `<div class="kv"><b>Intro:</b> ${esc(value.introDialogue)}</div>` : ""}${value.victoryDialogue ? `<div class="kv"><b>Defeated:</b> ${esc(value.victoryDialogue)}</div>` : ""}${value.defeatDialogue ? `<div class="kv"><b>Victory:</b> ${esc(value.defeatDialogue)}</div>` : ""}${value.battleBgm ? `<div class="kv"><b>Music:</b> ${esc(bridge()?.bgmLabel?.(value.battleBgm) || titleCase(value.battleBgm))}</div>` : ""}${value.trainerEffect ? `<div class="kv"><b>Effect:</b> ${esc(bridge()?.fxLabel?.(value.trainerEffect) || titleCase(value.trainerEffect))}</div>` : ""}</div></div>`;
  }

  function rowsHtml(rows, item) {
    return `<div class="sug-rows">${rows.map(row => `<div class="sug-row"><strong class="lb">${esc(row.label)}</strong><div class="sug-col-labels"><span>Current</span><span></span><span>Proposed</span><span>Author</span></div><div class="sug-values"><span class="sug-old">${esc(row.before)}</span><span class="sug-arr">-&gt;</span><span class="sug-new">${esc(row.after)}</span><span class="sug-by"><span class="sug-avatar">${esc(item.author?.[0]?.toUpperCase() || "?")}</span>${esc(item.author || "Trainer")}</span></div></div>`).join("")}</div>`;
  }
  const contextFor = (item, tab, key) =>
    contexts(item).find(context => context.tab === tab && context.key === key) || firstContext(item, tab);

  function suggestionItemHtml(item, tab, key) {
    const context = contextFor(item, tab, key);
    if (!context) {
      return "";
    }
    const before = contextValue(item, context, "before");
    const after = contextValue(item, context, "after");
    const isNewTrainer = context.file === "custom-trainers" && (before === null || before === undefined) && after;
    const rows = diffRows(before, after, context);
    const body = isNewTrainer
      ? trainerPreviewHtml(after)
      : context.file === "custom-trainers" && (!before || !after)
        ? trainerPreviewHtml(after)
        : rowsHtml(rows, item);
    const identity = isNewTrainer
      ? `<div class="sug-item-head"><span class="sug-avatar">${esc(item.author?.[0]?.toUpperCase() || "?")}</span><strong>${esc(item.author || "Trainer")}</strong><span class="sug-newtag">NEW TRAINER</span></div>`
      : "";
    return `<article class="sug-item" data-suggestion-item="${esc(item.id)}">${identity}${body || '<div class="sug-note">No changed values in this context.</div>'}<div class="sug-review-reason-label">Reasoning</div><div class="sug-reason-line">${esc(item.reason || "No reasoning was provided.")}</div><div class="sug-item-actions"><button type="button" class="approve" data-sug-action="approve" data-sug-id="${esc(item.id)}">Approve &amp; stage</button><button type="button" class="dismiss" data-sug-action="dismiss" data-sug-id="${esc(item.id)}">Dismiss</button><button type="button" data-sug-next="${esc(item.id)}">Next</button></div></article>`;
  }

  function makeContextPanel(tab, key, relevant, options = {}) {
    const active = relevant.find(item => item.id === revealId) || relevant[0];
    const panel = document.createElement("section");
    panel.className = `sug-ctx${options.drawer ? " sug-review-drawer" : ""}`;
    panel.id = `suggestion-review-${active.id}`;
    panel.tabIndex = -1;
    panel.innerHTML = `<div class="sug-ctx-head"><span>${esc(options.title || "Proposed changes")}</span><span class="suggestion-count">${relevant.length}</span></div>${suggestionItemHtml(active, tab, key)}`;
    if (error && reviewErrorId === active.id) {
      panel.insertAdjacentHTML("beforeend", reviewErrorHtml());
    }
    bindReviewActions(panel, tab, key);
    return panel;
  }

  function bindReviewActions(container, tab, key) {
    container.querySelectorAll("[data-sug-id]").forEach(button => {
      button.disabled = pendingReviews.has(button.dataset.sugId);
    });
    container.querySelectorAll("[data-sug-action]").forEach(button =>
      button.addEventListener("click", event => {
        event.stopPropagation();
        void reviewById(button.dataset.sugId, button.dataset.sugAction);
      }),
    );
    container.querySelectorAll("[data-sug-next]").forEach(button =>
      button.addEventListener("click", event => {
        event.stopPropagation();
        navigateNext(button.dataset.sugNext, tab, key);
      }),
    );
  }

  function decorateCards(root, tab, selector, keyFromElement, insertTarget) {
    for (const element of root.querySelectorAll(selector)) {
      const key = keyFromElement(element);
      const relevant = itemsFor(tab, key);
      if (relevant.length === 0) {
        continue;
      }
      const name = element.querySelector(".name, .ctr-card-head, .nm") || element;
      name.appendChild(entityBadge(tab, key, relevant));
      element.addEventListener("click", event => {
        if (event.target.closest("input, select, textarea, button, [role=button]")) {
          return;
        }
        navigateTo(relevant[0].id, tab, key);
      });
      if (revealId && relevant.some(item => item.id === revealId)) {
        const target = insertTarget === undefined ? element : insertTarget(element);
        element.classList.add("sug-open");
        target?.appendChild(makeContextPanel(tab, key, relevant));
      }
    }
  }

  function decoratePokedex(root, tab) {
    decorateCards(
      root,
      tab,
      "[data-pdpick]",
      element => element.dataset.pdpick,
      () => null,
    );
    const selectedElement = root.querySelector("[data-pdpick].sel");
    const selected = selectedElement?.dataset.pdpick;
    const relevant = selected ? itemsFor(tab, selected) : [];
    if (relevant.length === 0) {
      return;
    }
    if (!revealId || !relevant.some(item => item.id === revealId)) {
      revealId = relevant[0].id;
    }
    const layout = root.querySelector(".pd");
    if (layout) {
      layout.classList.add("sug-review-open");
      layout.appendChild(makeContextPanel(tab, selected, relevant, { drawer: true, title: TAB_LABELS[tab] }));
    }
    requestAnimationFrame(() =>
      selectedElement.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" }),
    );
  }

  function decorateGame(root) {
    for (const item of openItems()) {
      for (const context of contexts(item).filter(entry => entry.tab === "game")) {
        const input = root.querySelector(`[data-balkey="${CSS.escape(context.key)}"]`);
        const row = input?.closest(".knob-row2");
        if (!row) {
          continue;
        }
        const relevant = itemsFor("game", context.key);
        if (!row.querySelector(".sug-ent")) {
          row.querySelector(".klabel")?.appendChild(entityBadge("game", context.key, relevant));
        }
        if (revealId && relevant.some(entry => entry.id === revealId) && !row.querySelector(".sug-ctx")) {
          row.appendChild(makeContextPanel("game", context.key, relevant));
        }
      }
    }
  }

  function decorateCustomTrainers(root) {
    decorateCards(
      root,
      "customtrainers",
      "[data-ctropen]",
      element => element.dataset.ctropen,
      () => root.querySelector(".ctr-layout-main"),
    );
    const config = itemsFor("customtrainers", "__config");
    const density = root.querySelector(".ctr-density");
    if (config.length > 0 && density) {
      density.querySelector("legend")?.appendChild(entityBadge("customtrainers", "__config", config));
      if (revealId && config.some(item => item.id === revealId)) {
        density.appendChild(makeContextPanel("customtrainers", "__config", config));
      }
    }
    const newItems = openItems().filter(item =>
      contexts(item).some(
        context =>
          context.file === "custom-trainers"
          && (contextValue(item, context, "before") === null || contextValue(item, context, "before") === undefined),
      ),
    );
    if (newItems.length > 0) {
      const firstSection = root.querySelector(".section");
      const strip = document.createElement("div");
      strip.className = "sug-strip";
      const label = document.createElement("span");
      label.className = "sug-new-proposals";
      label.textContent = "New trainer proposals ";
      const first = firstContext(newItems[0], "customtrainers");
      label.appendChild(entityBadge("customtrainers", first.key, newItems));
      strip.appendChild(label);
      const revealed = newItems.find(item => item.id === revealId);
      if (revealed) {
        const context = firstContext(revealed, "customtrainers");
        strip.appendChild(makeContextPanel("customtrainers", context.key, [revealed]));
      }
      firstSection?.insertBefore(strip, firstSection.querySelector(".ctr-density"));
    }
  }

  function decorate(tab, root) {
    if (document.body.classList.contains("community-mode")) {
      return;
    }
    if (!loaded) {
      void load();
      return;
    }
    syncNavBadges();
    if (tab === "eggmoves" || tab === "species" || tab === "items") {
      decorateCards(root, tab, "[data-card]", element => element.dataset.card);
    } else if (["learnsets", "tms", "abilities"].includes(tab)) {
      decoratePokedex(root, tab);
    } else if (tab === "game") {
      decorateGame(root);
    } else if (tab === "customtrainers") {
      decorateCustomTrainers(root);
    }
    requestAnimationFrame(() => {
      const panel = revealId ? document.querySelector(`#suggestion-review-${CSS.escape(revealId)}`) : null;
      panel?.scrollIntoView({ block: "center", behavior: "auto" });
      panel?.focus({ preventScroll: true });
    });
  }

  function navigateTo(id, preferredTab = "", preferredKey = "") {
    const item = items.find(entry => entry.id === id);
    if (!item) {
      return;
    }
    const context =
      contexts(item).find(entry => entry.tab === preferredTab && (!preferredKey || entry.key === preferredKey))
      || firstContext(item, preferredTab);
    if (!context) {
      return;
    }
    revealId = id;
    selectedId = id;
    bridge()?.navigate?.(context);
  }

  function navigateNext(id, tab, key) {
    const sameTarget = itemsFor(tab, key);
    const sameIndex = sameTarget.findIndex(item => item.id === id);
    if (sameTarget[sameIndex + 1]) {
      navigateTo(sameTarget[sameIndex + 1].id, tab, key);
      return;
    }
    const sameTab = openItems().filter(item => contexts(item).some(context => context.tab === tab));
    const index = sameTab.findIndex(item => item.id === id);
    const next = sameTab[index + 1] || sameTab[0];
    if (next && next.id !== id) {
      navigateTo(next.id, tab);
    }
  }

  function stage(item) {
    if (!staged.some(entry => entry.id === item.id)) {
      staged.push(clone(item));
      persistStaged();
    }
  }

  function patchChangedLeaves(current, before, after) {
    if (equal(before, after)) {
      return clone(current);
    }
    if (
      before
      && after
      && current
      && typeof before === "object"
      && !Array.isArray(before)
      && typeof after === "object"
      && !Array.isArray(after)
      && typeof current === "object"
      && !Array.isArray(current)
    ) {
      const result = clone(current);
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!equal(before[key], after[key])) {
          result[key] = patchChangedLeaves(current[key], before[key], after[key]);
        }
      }
      return result;
    }
    return clone(after);
  }

  function approvedEntityValue(file, key, before, after) {
    const current = bridge()?.currentValue?.(file, key);
    if (file === "egg-moves" && Array.isArray(before) && Array.isArray(after)) {
      const result = Array.isArray(current) ? [...current] : [...before];
      for (let index = 0; index < Math.max(before.length, after.length); index += 1) {
        if (!equal(before[index], after[index])) {
          result[index] = clone(after[index]);
        }
      }
      return result;
    }
    if (file === "learnsets" && Array.isArray(before) && Array.isArray(after)) {
      const result = Array.isArray(current) ? clone(current) : clone(before);
      const beforeByMove = new Map(before.map(entry => [entry[1], entry[0]]));
      const afterByMove = new Map(after.map(entry => [entry[1], entry[0]]));
      for (const move of new Set([...beforeByMove.keys(), ...afterByMove.keys()])) {
        if (beforeByMove.get(move) === afterByMove.get(move)) {
          continue;
        }
        const index = result.findIndex(entry => entry[1] === move);
        if (!afterByMove.has(move)) {
          if (index >= 0) {
            result.splice(index, 1);
          }
        } else if (index >= 0) {
          result[index][0] = afterByMove.get(move);
        } else {
          result.push([afterByMove.get(move), move]);
        }
      }
      return result;
    }
    if (file === "tm-learnsets" && Array.isArray(before) && Array.isArray(after)) {
      const result = new Set(Array.isArray(current) ? current : before);
      before.filter(move => !after.includes(move)).forEach(move => result.delete(move));
      after.filter(move => !before.includes(move)).forEach(move => result.add(move));
      return [...result];
    }
    return patchChangedLeaves(current ?? before, before, after);
  }

  function approvedChanges(item) {
    const result = {};
    for (const context of contexts(item)) {
      const before = contextValue(item, context, "before");
      const after = contextValue(item, context, "after");
      if (context.key === "__config") {
        result[context.file] = patchChangedLeaves(bridge()?.currentValue?.(context.file), before, after);
      } else {
        result[context.file] ||= {};
        result[context.file][context.key] = approvedEntityValue(context.file, context.key, before, after);
      }
    }
    return result;
  }

  async function reviewById(id, action) {
    const item = items.find(entry => entry.id === id);
    if (!item || pendingReviews.has(id)) {
      return;
    }
    error = "";
    reviewErrorId = "";
    pendingReviews.add(id);
    document.querySelectorAll("[data-sug-id]").forEach(button => {
      if (button.dataset.sugId === id) {
        button.disabled = true;
      }
    });
    try {
      const context = firstContext(item);
      const remaining = context ? itemsFor(context.tab, context.key).filter(entry => entry.id !== id) : [];
      const changes = action === "approve" ? approvedChanges(item) : null;
      await staffRequest("/community/editor-suggestions/staff/review", { id, action });
      if (action === "approve") {
        stage({ ...item, status: "approved", changes });
        bridge()?.applyChanges?.(changes);
        appliedStaged.add(item.id);
      }
      const nextStatus = action === "approve" ? "approved" : "dismissed";
      item.status = nextStatus;
      if (demo) {
        persistDemoReview(item, nextStatus);
      }
      revealId = remaining[0]?.id || "";
    } catch (cause) {
      error =
        cause.name === "TimeoutError"
          ? "Review timed out. Refresh suggestions to check its status before retrying."
          : cause.message || "Could not review the suggestion. Please retry.";
      reviewErrorId = id;
    } finally {
      pendingReviews.delete(id);
      syncNavBadges();
      bridge()?.activeTab?.() === "suggestions" ? drawAggregate() : bridge()?.render?.();
    }
  }

  function reviewErrorHtml() {
    return error ? `<div class="sug-review-error" role="alert">${esc(error)}</div>` : "";
  }

  function summaryFor(item, context) {
    if (!context) {
      return item.entityLabel;
    }
    const before = contextValue(item, context, "before");
    const after = contextValue(item, context, "after");
    if (context.file === "custom-trainers" && (before === null || before === undefined)) {
      return "New custom trainer";
    }
    return (
      diffRows(before, after, context)
        .slice(0, 2)
        .map(row => row.label)
        .join(", ") || item.entityLabel
    );
  }

  function renderAggregateRows(list) {
    const groups = new Map();
    for (const item of list) {
      const context = firstContext(item);
      const tab = context?.tab || "other";
      if (!groups.has(tab)) {
        groups.set(tab, []);
      }
      groups.get(tab).push({ item, context });
    }
    if (list.length === 0) {
      return `<div class="sug-empty">${loading ? "Loading suggestions..." : error || "No suggestions match this view."}</div>`;
    }
    return [...groups.entries()]
      .map(
        ([tab, entries]) =>
          `<section class="sug-group" data-sug-group="${esc(tab)}"><button type="button" class="sug-group-head" data-sug-toggle="${esc(tab)}"><span class="caret">v</span><span>${esc(TAB_LABELS[tab] || "Other")}</span><span class="sug-groupheadbadge">${entries.length}</span></button><div class="sug-group-body">${entries.map(({ item, context }) => `<div class="sug-rowitem${selectedId === item.id ? " active" : ""}" data-suggestion="${esc(item.id)}"><span class="sug-radio"></span><strong class="sug-main">${esc(item.entityLabel)}</strong><span class="sug-status ${esc(item.status)}">${esc(item.status)}</span><span class="sug-excerpt">${esc(summaryFor(item, context))}</span><span class="sug-by"><span class="sug-avatar">${esc(item.author?.[0]?.toUpperCase() || "?")}</span>${esc(item.author || "Trainer")}</span>${context ? `<button type="button" class="sug-goto" data-sug-goto="${esc(item.id)}" data-sug-tab="${esc(context.tab)}">Review in ${esc(TAB_LABELS[context.tab])}</button>` : ""}</div>`).join("")}</div></section>`,
      )
      .join("");
  }

  function stat(label, value) {
    return `<div class="sug-stat"><b>${Number(value || 0).toLocaleString()}</b><small>${esc(label)}</small></div>`;
  }

  function renderInspector(item) {
    if (!item) {
      return `<h3>Reviewer tools</h3><p class="hint">Select a suggestion to inspect its author and reasoning.</p>`;
    }
    const stats = item.authorStats || {};
    const context = firstContext(item);
    const isIgnored = ignored.has(item.author);
    const reviewActions =
      item.status === "open"
        ? `<div class="sug-item-actions"><button type="button" class="approve" data-sug-action="approve" data-sug-id="${esc(item.id)}">Approve &amp; stage</button><button type="button" class="dismiss" data-sug-action="dismiss" data-sug-id="${esc(item.id)}">Dismiss</button></div>`
        : "";
    return `<h3>Suggestion</h3><strong>${esc(item.entityLabel)}</strong><div class="sug-excerptbox">${esc(summaryFor(item, context))}</div><h4>Reasoning</h4><div class="sug-quote">${esc(item.reason || "No reasoning was provided.")}</div>${reviewActions}<h3>Author</h3><div class="sug-author-button"><span class="sug-avatar">${esc(item.author?.[0]?.toUpperCase() || "?")}</span><span><strong>${esc(item.author || "Trainer")}</strong><small>${item.authorAppliedCount || 0} applied of ${item.authorSuggestionCount || 0} suggestions</small></span></div><div class="sug-stats">${stat("Achievement points", stats.achievementPoints)}${stat("Runs won", stats.sessionsWon)}${stat("Ribbons", stats.ribbons)}${stat("Shiny species", stats.shinySpecies)}${stat("Highest damage", stats.highestDamage)}${stat("Unique relics", stats.uniqueRelics)}</div><p class="hint">Aggregate game stats are visible only to authenticated editor staff.</p><button class="sug-ignore" data-ignore="${esc(item.author)}">${isIgnored ? "Show" : "Ignore"} ${esc(item.author)} ${isIgnored ? "again" : "on this device"}</button>`;
  }

  function drawAggregate() {
    if (!aggregateRoot || bridge()?.activeTab?.() !== "suggestions") {
      return;
    }
    const list = visibleItems();
    const selected = list.find(item => item.id === selectedId) || list[0] || null;
    if (selected && selected.id !== selectedId) {
      selectedId = selected.id;
    }
    aggregateRoot.innerHTML = `<div class="sug-shell"><section class="sug-index"><div class="sug-toolbarline"><select id="sug-status"><option value="open">Open</option><option value="approved">Approved</option><option value="dismissed">Dismissed</option><option value="applied">Applied</option><option value="all">All</option></select><input id="sug-search" class="grow" type="search" placeholder="Filter by Pokemon, field, tab, or author" value="${esc(query)}"><label class="check"><input id="sug-ignored" type="checkbox"${showIgnored ? " checked" : ""}${ignored.size > 0 ? "" : " disabled"}> Show ignored</label><button type="button" id="sug-refresh" class="push-right">Refresh</button></div>${renderAggregateRows(list)}</section><aside class="sug-inspector">${renderInspector(selected)}</aside></div>`;
    aggregateRoot.querySelector("#sug-status").value = status;
    aggregateRoot.querySelector(".sug-index").insertAdjacentHTML("afterbegin", reviewErrorHtml());
    bindAggregate();
  }

  function bindAggregate() {
    bindReviewActions(aggregateRoot, "", "");
    aggregateRoot.querySelector("#sug-status")?.addEventListener("change", event => {
      status = event.target.value;
      selectedId = "";
      drawAggregate();
    });
    aggregateRoot.querySelector("#sug-search")?.addEventListener("input", event => {
      query = event.target.value;
      selectedId = "";
      drawAggregate();
      aggregateRoot.querySelector("#sug-search")?.focus();
    });
    aggregateRoot.querySelector("#sug-ignored")?.addEventListener("change", event => {
      showIgnored = event.target.checked;
      selectedId = "";
      drawAggregate();
    });
    aggregateRoot.querySelector("#sug-refresh")?.addEventListener("click", () => void load(true));
    aggregateRoot.querySelectorAll("[data-suggestion]").forEach(row =>
      row.addEventListener("click", event => {
        if (!event.target.closest("[data-sug-goto]")) {
          selectedId = row.dataset.suggestion;
          drawAggregate();
        }
      }),
    );
    aggregateRoot.querySelectorAll("[data-sug-goto]").forEach(button =>
      button.addEventListener("click", event => {
        event.stopPropagation();
        navigateTo(button.dataset.sugGoto, button.dataset.sugTab);
      }),
    );
    aggregateRoot.querySelectorAll("[data-sug-toggle]").forEach(button =>
      button.addEventListener("click", () => {
        const body = button.nextElementSibling;
        body.hidden = !body.hidden;
        button.querySelector(".caret").textContent = body.hidden ? ">" : "v";
      }),
    );
    aggregateRoot.querySelector("[data-ignore]")?.addEventListener("click", event => {
      const author = event.currentTarget.dataset.ignore;
      ignored.has(author) ? ignored.delete(author) : ignored.add(author);
      localStorage.setItem(IGNORED_KEY, JSON.stringify([...ignored]));
      selectedId = "";
      drawAggregate();
    });
  }

  function mergeMissing(target, source) {
    for (const [key, value] of Object.entries(source || {})) {
      if (!(key in target)) {
        target[key] = clone(value);
      } else if (
        value
        && typeof value === "object"
        && !Array.isArray(value)
        && target[key]
        && typeof target[key] === "object"
        && !Array.isArray(target[key])
      ) {
        mergeMissing(target[key], value);
      }
    }
    return target;
  }

  window.communitySuggestions = {
    describe(item) {
      return contexts(item).map(context => ({
        tab: context.tab,
        tabLabel: TAB_LABELS[context.tab] || titleCase(context.tab),
        rows: diffRows(contextValue(item, context, "before"), contextValue(item, context, "after"), context),
      }));
    },
    render(container) {
      aggregateRoot = container;
      drawAggregate();
      void load();
    },
    decorate,
    stagedCount() {
      return 0;
    },
    mergeStagedDeltas(deltas) {
      for (const item of staged) {
        for (const [file, delta] of Object.entries(item.changes || {})) {
          deltas[file] = mergeMissing(deltas[file] || {}, delta);
        }
      }
    },
    async markStagedApplied(editorPassword) {
      const applied = [];
      for (const item of staged) {
        try {
          if (!demo) {
            const response = await fetch(`${API}/community/editor-suggestions/staff/review`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password: editorPassword, id: item.id, action: "applied" }),
            });
            if (!response.ok) {
              continue;
            }
          }
          applied.push(item.id);
        } catch {
          // Keep staged for a later retry.
        }
      }
      staged = staged.filter(item => !applied.includes(item.id));
      persistStaged();
    },
  };

  window.addEventListener("storage", event => {
    if (demo && event.key === DEMO_QUEUE_KEY) {
      loaded = false;
      void load(true);
    }
  });
  window.addEventListener("community-demo-suggestion", () => {
    if (demo) {
      loaded = false;
      void load(true);
    }
  });
  document.querySelector("#password")?.addEventListener("change", () => {
    if (!demo) {
      loaded = false;
      void load(true);
    }
  });
  if (!demo && !window.communityEditorMode?.enabled) {
    fetch(`${API}/community/editor-suggestions/counts`)
      .then(response => response.json())
      .then(data => {
        const count = (data.items || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
        const aggregate = document.querySelector("#suggestion-nav-count");
        if (aggregate && count && !loaded) {
          aggregate.className = "suggestion-count";
          aggregate.textContent = String(count);
        }
      })
      .catch(() => {});
  }
})();
