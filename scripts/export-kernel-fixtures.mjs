import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildSchema,
  EXPECTED_PROTOCOL_VERSION,
  FIXTURE_DIGEST_KIND,
  FIXTURE_DIRECTORY,
  makeEnvelope,
  ORACLE_GAME_SHA,
  verifyOracleSha,
  writeJson,
} from "./export-kernel-schema.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(`[kernel-fixtures] ${message}`);
}

function must(value, label) {
  if (value === undefined) {
    fail(`missing source-derived value ${label}`);
  }
  return value;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function assertUnique(values, label) {
  assert(new Set(values).size === values.length, `${label} contains duplicate values`);
}

function canonicalCommandTargets(commands) {
  return [...commands].sort(
    (left, right) =>
      left.fieldIndex - right.fieldIndex || left.ownerSeatId - right.ownerSeatId || left.pokemonId - right.pokemonId,
  );
}

function canonicalInteractionKinds(kinds) {
  return [...new Set(kinds)].sort();
}

function canonicalOpaqueIds(ids) {
  return [...new Set(ids)].sort();
}

function canonicalSuccessorKinds(kinds, entryKinds) {
  const order = new Map(entryKinds.map((kind, index) => [kind, index]));
  return [...new Set(kinds)].sort((left, right) => order.get(left) - order.get(right));
}

function canonicalAllowedInteractionAddresses(addresses) {
  if (addresses == null) {
    return "*";
  }
  return [...addresses]
    .map(
      address =>
        `${encodeURIComponent(address.surfaceClass)}:${encodeURIComponent(address.operationKind)}`
        + `:w${address.wave}:t${address.turn}`,
    )
    .sort()
    .join(",");
}

function canonicalAllowedControlAddresses(addresses) {
  if (addresses == null) {
    return "*";
  }
  return [...addresses]
    .map(
      address =>
        `${address.materialKind}:w${address.wave}:t${address.turn}:id${
          address.operationId == null ? "*" : encodeURIComponent(address.operationId)
        }`,
    )
    .sort()
    .join(",");
}

/** Exact port of next-control.ts controlIdOf for the emitted control probes. */
function controlIdOf(control, entryKinds) {
  switch (control.kind) {
    case "COMMAND_FRONTIER":
      return (
        `COMMAND_FRONTIER/e${control.epoch}/w${control.wave}/t${control.turn}`
        + `/${canonicalCommandTargets(control.commands)
          .map(target => `f${target.fieldIndex}:s${target.ownerSeatId}:p${target.pokemonId}`)
          .join(",")}`
      );
    case "REPLACEMENT":
      return (
        `REPLACEMENT/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`
        + `/e${control.epoch}/w${control.wave}/t${control.turn}`
        + `/o${control.occurrence}/f${control.fieldIndex}`
        + `/remaining:${control.remaining
          .map(
            target =>
              `${encodeURIComponent(target.operationId)}:s${target.ownerSeatId}:e${target.epoch}:w${target.wave}`
              + `:t${target.turn}:o${target.occurrence}:f${target.fieldIndex}`,
          )
          .join(",")}`
      );
    case "SHARED_INTERACTION":
      return (
        `SHARED_INTERACTION/${encodeURIComponent(control.surfaceClass)}`
        + `/${encodeURIComponent(control.operationKind)}`
        + `/${encodeURIComponent(control.operationId)}/s${control.ownerSeatId}`
        + `/e${control.epoch}/w${control.wave}/t${control.turn}`
        + `/results:${canonicalInteractionKinds(control.successor.operationKinds).join(",")}`
        + `/resultIds:${
          control.successor.operationIds == null
            ? "*"
            : canonicalOpaqueIds(control.successor.operationIds).map(encodeURIComponent).join(",")
        }`
      );
    case "AWAIT_SUCCESSOR":
      return (
        `AWAIT_SUCCESSOR/${encodeURIComponent(control.afterOperationId)}`
        + `/e${control.epoch}/w${control.wave}/t${control.turn}`
        + `/${canonicalSuccessorKinds(control.allowedKinds, entryKinds).join(",")}`
        + `/interactionAddresses:${canonicalAllowedInteractionAddresses(control.allowedInteractionAddresses)}`
        + `/controlAddresses:${canonicalAllowedControlAddresses(control.allowedControlAddresses)}`
        + `/nextWave:${control.allowNextWaveStart ? "1" : "0"}`
        + `/next:${control.expectedOperationId == null ? "*" : encodeURIComponent(control.expectedOperationId)}`
      );
    case "TERMINAL":
      return `TERMINAL/${encodeURIComponent(control.terminalId)}`;
    default:
      fail(`cannot derive control id for unknown control kind ${String(control.kind)}`);
  }
}

function frameContext(senderSeatId = 1) {
  return {
    sessionId: "fixture-session",
    runId: "fixture-run",
    sessionEpoch: 1,
    seatMapId: "fixture-seat-map",
    membershipRevision: 1,
    senderSeatId,
    authoritySeatId: 0,
    connectionGeneration: 2,
  };
}

function buildNextControlPayload(schema) {
  const entryKinds = schema.authority_v2.entry_kinds;
  const surfaces = schema.authority_v2.interaction_operation_surfaces;
  const sharedOperationKind = must(
    Object.keys(surfaces).find(kind => surfaces[kind].includes("op:ability")),
    "an interaction operation kind for op:ability",
  );
  const sharedSurface = surfaces[sharedOperationKind][0];
  const awaitOperationKind = must(
    Object.keys(surfaces).find(kind => surfaces[kind].includes("op:me")),
    "an interaction operation kind for op:me",
  );

  const command = {
    kind: "COMMAND_FRONTIER",
    epoch: 1,
    wave: 2,
    turn: 1,
    commands: [
      { ownerSeatId: 1, pokemonId: 202, fieldIndex: 1 },
      { ownerSeatId: 0, pokemonId: 101, fieldIndex: 0 },
    ],
  };
  const replacement = {
    kind: "REPLACEMENT",
    operationId: "replacement/e1/w2/t1/o0/f0",
    ownerSeatId: 0,
    epoch: 1,
    wave: 2,
    turn: 1,
    occurrence: 0,
    fieldIndex: 0,
    remaining: [
      {
        operationId: "replacement/e1/w2/t1/o1/f1",
        ownerSeatId: 1,
        epoch: 1,
        wave: 2,
        turn: 1,
        occurrence: 1,
        fieldIndex: 1,
      },
    ],
  };
  const sharedInteraction = {
    kind: "SHARED_INTERACTION",
    operationId: "interaction/e1/w2/t1/ability",
    ownerSeatId: 1,
    epoch: 1,
    wave: 2,
    turn: 1,
    surfaceClass: sharedSurface,
    operationKind: sharedOperationKind,
    successor: {
      operationKinds: [sharedOperationKind],
      // Null is explicit in the TypeScript contract: a wildcard over the
      // closed operationKinds set, not an absent/locally-derived successor.
      operationIds: null,
    },
  };
  const awaitSuccessor = {
    kind: "AWAIT_SUCCESSOR",
    afterOperationId: "turn/e1/w2/t1",
    epoch: 1,
    wave: 2,
    turn: 1,
    allowedKinds: entryKinds.slice(),
    allowedInteractionAddresses: [
      {
        surfaceClass: "op:me",
        operationKind: awaitOperationKind,
        wave: 2,
        turn: 1,
      },
    ],
    allowedControlAddresses: [{ materialKind: "command-open", wave: 2, turn: 2, operationId: null }],
    allowNextWaveStart: false,
    expectedOperationId: null,
  };
  const terminal = { kind: "TERMINAL", terminalId: "terminal/e1/w2" };
  const controls = [
    { id: "command-frontier", control: command },
    { id: "replacement", control: replacement },
    { id: "shared-interaction", control: sharedInteraction },
    { id: "await-successor", control: awaitSuccessor },
    { id: "terminal", control: terminal },
  ].map(fixture => ({
    ...fixture,
    control_id: controlIdOf(fixture.control, entryKinds),
    expected_shape: "valid per nextControlIssues()",
  }));
  return {
    canonical_algorithm: "next-control.ts: controlIdOf",
    source_file: schema.source_files.nextControl,
    fixtures: controls,
  };
}

function buildReceiptPayload(schema) {
  const command = {
    kind: "COMMAND_FRONTIER",
    epoch: 1,
    wave: 2,
    turn: 1,
    commands: [{ ownerSeatId: 1, pokemonId: 202, fieldIndex: 1 }],
  };
  const controlId = controlIdOf(command, schema.authority_v2.entry_kinds);
  const stages = schema.authority_v2.ack_stages;
  assertUnique(stages, "receipt stages");
  return {
    source_file: schema.source_files.authorityContract,
    context_source_file: schema.source_files.frameContext,
    fixtures: stages.map((stage, index) => ({
      id: stage,
      receipt: {
        context: frameContext(),
        revision: 1,
        operationId: "turn/e1/w2/t1",
        stage,
        ...(stage === "controlInstalled" ? { controlId } : {}),
      },
      expected_shape: stage === "controlInstalled" ? "controlId is present" : "controlId is absent",
      sequence: index + 1,
    })),
  };
}

function clampStage(value) {
  return value < -6 ? -6 : value > 6 ? 6 : Math.trunc(value);
}

function coopStatusSubState(fields) {
  const toxicTurnCount =
    fields.statusToxicTurnCount !== undefined
    && Number.isFinite(fields.statusToxicTurnCount)
    && fields.statusToxicTurnCount > 0
      ? Math.trunc(fields.statusToxicTurnCount)
      : 0;
  const sleepTurnsRemaining =
    fields.statusSleepTurnsRemaining !== undefined
    && Number.isFinite(fields.statusSleepTurnsRemaining)
    && fields.statusSleepTurnsRemaining >= 0
      ? Math.trunc(fields.statusSleepTurnsRemaining)
      : undefined;
  return { toxicTurnCount, sleepTurnsRemaining };
}

/** Exact pure transform port of coop-battle-checkpoint.ts serializeMonState. */
function serializeMonState(mon) {
  const maxHp = Math.max(1, Math.trunc(mon.maxHp));
  const hp = Math.max(0, Math.min(maxHp, Math.trunc(mon.hp)));
  const state = {
    bi: mon.bi,
    partyIndex: Math.trunc(mon.partyIndex ?? -1),
    speciesId: Math.max(0, Math.trunc(mon.speciesId ?? 0)),
    hp,
    maxHp,
    status: Math.max(0, Math.trunc(mon.status)),
    statStages: Array.from({ length: 7 }, (_, index) => clampStage(mon.statStages[index] ?? 0)),
    fainted: mon.fainted || hp === 0,
  };
  if (mon.formIndex !== undefined && Number.isSafeInteger(mon.formIndex) && mon.formIndex >= 0) {
    state.formIndex = Math.trunc(mon.formIndex);
  }
  if (mon.abilityId !== undefined) {
    state.abilityId = mon.abilityId;
  }
  if (mon.moves !== undefined) {
    state.moves = mon.moves.map(move => ({
      id: Math.max(0, Math.trunc(move.id)),
      ppUsed: Math.max(0, Math.trunc(move.ppUsed)),
    }));
  }
  if (typeof mon.isTerastallized === "boolean") {
    state.isTerastallized = mon.isTerastallized;
  }
  if (typeof mon.teraType === "number") {
    state.teraType = Math.trunc(mon.teraType);
  }
  if (mon.coopOwner === "host" || mon.coopOwner === "guest") {
    state.coopOwner = mon.coopOwner;
  }
  const statusSub = coopStatusSubState(mon);
  if (statusSub.toxicTurnCount > 0) {
    state.statusToxicTurnCount = statusSub.toxicTurnCount;
  }
  if (statusSub.sleepTurnsRemaining !== undefined) {
    state.statusSleepTurnsRemaining = statusSub.sleepTurnsRemaining;
  }
  if (mon.erTags !== undefined && mon.erTags.length > 0) {
    state.erTags = mon.erTags
      .filter(tag => typeof tag.type === "string")
      .map(tag => ({ type: tag.type, turns: Math.max(0, Math.trunc(tag.turns)) }));
  }
  return state;
}

function serializeArenaTag(tag) {
  return {
    tagType: tag.tagType,
    side: Math.max(0, Math.trunc(tag.side)),
    turnCount: Math.max(0, Math.trunc(tag.turnCount)),
    layers: Math.max(1, Math.trunc(tag.layers)),
  };
}

/** Exact pure transform port of coop-battle-checkpoint.ts buildCheckpoint. */
function buildCheckpoint(mons, arena, money) {
  const checkpoint = {
    field: mons.map(serializeMonState),
    weather: Math.max(0, Math.trunc(arena.weather)),
    weatherTurnsLeft: Math.max(0, Math.trunc(arena.weatherTurnsLeft)),
    terrain: Math.max(0, Math.trunc(arena.terrain)),
    terrainTurnsLeft: Math.max(0, Math.trunc(arena.terrainTurnsLeft)),
  };
  if (money !== undefined && Number.isFinite(money) && money >= 0) {
    checkpoint.money = Math.trunc(money);
  }
  if (arena.arenaTags !== undefined) {
    checkpoint.arenaTags = arena.arenaTags.filter(tag => typeof tag.tagType === "string").map(serializeArenaTag);
  }
  return checkpoint;
}

/** Exact pure transform port of coop-battle-checkpoint.ts normalizeMonState. */
function normalizeMonState(state) {
  const mon = {
    bi: state.bi,
    partyIndex: state.partyIndex,
    speciesId: state.speciesId,
    hp: state.hp,
    maxHp: state.maxHp,
    status: state.status,
    statStages: state.statStages,
    fainted: state.fainted,
  };
  for (const key of [
    "statusToxicTurnCount",
    "statusSleepTurnsRemaining",
    "formIndex",
    "abilityId",
    "erTags",
    "moves",
    "isTerastallized",
    "teraType",
    "coopOwner",
  ]) {
    if (Object.hasOwn(state, key)) {
      mon[key] = state[key];
    }
  }
  return serializeMonState(mon);
}

function buildCheckpointPayload(schema) {
  const clampMons = [
    {
      bi: 0,
      partyIndex: -2,
      speciesId: -1,
      hp: 125.9,
      maxHp: 100.2,
      status: -1,
      statusToxicTurnCount: 3.9,
      statusSleepTurnsRemaining: -1,
      statStages: [-9, -6.4, 0, 6.9, 8, 1.8],
      fainted: false,
      formIndex: 2.2,
      abilityId: 7.8,
      erTags: [
        { type: "bleed", turns: 2.8 },
        { type: 7, turns: 3 },
      ],
      moves: [
        { id: -2.2, ppUsed: 5.8 },
        { id: 10, ppUsed: -1 },
      ],
      isTerastallized: true,
      teraType: 3.9,
      coopOwner: "guest",
    },
    {
      bi: 1,
      partyIndex: 1.9,
      speciesId: 25.9,
      hp: -1,
      maxHp: 0,
      status: 2.9,
      statusSleepTurnsRemaining: 2.9,
      statStages: [0, 0, 0, 0, 0, 0, 0, 99],
      fainted: false,
      coopOwner: "host",
    },
  ];
  const clampArena = {
    weather: -2.2,
    weatherTurnsLeft: 4.9,
    terrain: 3.9,
    terrainTurnsLeft: -1.2,
    arenaTags: [
      { tagType: "Spikes", side: -1, turnCount: -2.4, layers: 0.4 },
      { tagType: 7, side: 2, turnCount: 1, layers: 1 },
    ],
  };
  const built = buildCheckpoint(clampMons, clampArena, 123.9);

  const omitted = buildCheckpoint(
    [
      {
        bi: 2,
        partyIndex: 2,
        speciesId: 133,
        hp: 20,
        maxHp: 20,
        status: 0,
        statStages: [0, 0, 0, 0, 0, 0, 0],
        fainted: false,
      },
    ],
    { weather: 0, weatherTurnsLeft: 0, terrain: 0, terrainTurnsLeft: 0 },
  );

  const normalizeInput = {
    bi: 3,
    partyIndex: 3,
    speciesId: 999,
    hp: 999,
    maxHp: 50,
    status: 4,
    statusToxicTurnCount: 4.9,
    statusSleepTurnsRemaining: 0.9,
    statStages: [-99, -1.9, 0, 1.9, 99, 4.9],
    fainted: false,
    formIndex: 1.9,
    abilityId: 12.9,
    erTags: [{ type: "fear", turns: -4.2 }],
    moves: [{ id: 7.9, ppUsed: -2 }],
    isTerastallized: false,
    teraType: 8.9,
    coopOwner: "guest",
  };
  return {
    source_file: schema.source_files.checkpoint,
    canonical_algorithms: ["serializeMonState", "serializeArenaTag", "buildCheckpoint", "normalizeMonState"],
    fixtures: [
      {
        id: "build-clamps-and-optional-fields",
        operation: "buildCheckpoint",
        input: { mons: clampMons, arena: clampArena, money: 123.9 },
        output: built,
      },
      {
        id: "build-omits-absent-optional-fields",
        operation: "buildCheckpoint",
        input: {
          mons: [
            {
              bi: 2,
              partyIndex: 2,
              speciesId: 133,
              hp: 20,
              maxHp: 20,
              status: 0,
              statStages: [0, 0, 0, 0, 0, 0, 0],
              fainted: false,
            },
          ],
          arena: { weather: 0, weatherTurnsLeft: 0, terrain: 0, terrainTurnsLeft: 0 },
        },
        output: omitted,
        absent_means: {
          money: "older caller / no money leaves guest money unchanged",
          arenaTags: "older host omits tags and guest leaves its tags unchanged",
        },
      },
      {
        id: "normalize-reclamps-received-state",
        operation: "normalizeMonState",
        input: normalizeInput,
        output: normalizeMonState(normalizeInput),
      },
    ],
  };
}

function makeReplayTrace(args, schema) {
  const difficulty = args.difficulty ?? args.coopRunConfig?.difficulty ?? "youngster";
  const challenges = args.challenges ?? args.coopRunConfig?.challenges ?? [];
  return {
    version: schema.replay_trace.version,
    seed: args.seed,
    gameModeId: args.gameModeId,
    difficulty,
    challenges,
    roster: args.roster,
    events: args.events,
    ...(args.coopRunConfig == null ? {} : { coop: { runConfig: args.coopRunConfig } }),
    ...(args.endState == null ? {} : { endState: args.endState }),
    ...(args.checkpoint == null ? {} : { checkpoint: args.checkpoint }),
  };
}

function validCommandKind(command) {
  switch (command.kind) {
    case "move":
      return Number.isInteger(command.moveIndex) && (command.target === undefined || Number.isInteger(command.target));
    case "switch":
      return Number.isInteger(command.partyIndex);
    case "ball":
      return Number.isInteger(command.ballIndex);
    case "run":
      return true;
    default:
      return false;
  }
}

/** Exact validation port of replay-trace.ts validateReplayTrace for fixture probes. */
function validateReplayTrace(trace, supportedVersions) {
  const errors = [];
  if (!supportedVersions.includes(trace.version)) {
    errors.push(`unsupported trace version ${trace.version} (loader supports ${supportedVersions.join("/")})`);
  }
  if (typeof trace.seed !== "string" || trace.seed.length === 0) {
    errors.push("missing run seed (a replay needs the seed to pin RNG)");
  }
  if (!Array.isArray(trace.roster) || trace.roster.length === 0) {
    errors.push("empty roster (a replay needs at least one starting mon)");
  }
  if (Array.isArray(trace.events)) {
    trace.events.forEach((event, index) => {
      if (event.type === "command") {
        if (!Number.isInteger(event.wave) || !Number.isInteger(event.turn) || !Number.isInteger(event.slotFieldIndex)) {
          errors.push(`event[${index}] command: wave/turn/slotFieldIndex must be integers`);
        }
        if (!validCommandKind(event.command)) {
          errors.push(`event[${index}] command: malformed command kind`);
        }
      } else if (event.type === "interaction") {
        if (!Number.isInteger(event.seq) || typeof event.kind !== "string" || !Number.isInteger(event.choice)) {
          errors.push(`event[${index}] interaction: seq/kind/choice malformed`);
        }
      } else {
        errors.push(`event[${index}]: unknown event type ${event.type}`);
      }
    });
  } else {
    errors.push("missing events array");
  }
  if (trace.coop != null && trace.coop.runConfig == null) {
    errors.push("coop layer present but missing runConfig");
  }
  if (trace.checkpoint != null) {
    const checkpoint = trace.checkpoint;
    if (!Number.isInteger(checkpoint.wave) || typeof checkpoint.seed !== "string" || checkpoint.seed.length === 0) {
      errors.push("checkpoint present but missing a valid wave/seed cursor");
    }
    if (!Array.isArray(checkpoint.party) || checkpoint.party.length === 0) {
      errors.push("checkpoint present but has an empty party (a boot needs at least one mon)");
    }
  }
  return { ok: errors.length === 0, errors };
}

function buildReplayPayload(schema) {
  const coopMode = must(
    schema.game_modes.members.find(member => member.name === "COOP"),
    "GameModes.COOP",
  ).value;
  const classicMode = must(
    schema.game_modes.members.find(member => member.name === "CLASSIC"),
    "GameModes.CLASSIC",
  ).value;
  const coopConfig = {
    difficulty: "elite",
    challenges: [{ id: 7, value: 2, severity: 1 }],
    seed: "fixture-coop-seed",
    netcodeMode: "authoritative",
    kind: "coop",
  };
  const validCoop = makeReplayTrace(
    {
      seed: "fixture-coop-seed",
      gameModeId: coopMode,
      roster: [
        { species: 1, level: 5, hp: 20, maxHp: 20, coopOwner: "host" },
        { species: 4, level: 5, hp: 20, maxHp: 20, coopOwner: "guest" },
      ],
      events: [
        { type: "command", wave: 1, turn: 0, slotFieldIndex: 0, command: { kind: "move", moveIndex: 0, target: 2 } },
        { type: "interaction", seq: 0, kind: "reward", choice: 1, data: [0, 0] },
      ],
      coopRunConfig: coopConfig,
    },
    schema,
  );
  const validSingle = makeReplayTrace(
    {
      seed: "fixture-solo-seed",
      gameModeId: classicMode,
      roster: [{ species: 25, level: 10, hp: 30, maxHp: 30 }],
      events: [{ type: "command", wave: 2, turn: 1, slotFieldIndex: 0, command: { kind: "run" } }],
      endState: {
        waveIndex: 2,
        money: 321,
        party: [{ species: 25, level: 10, hp: 30, maxHp: 30 }],
      },
      checkpoint: {
        wave: 2,
        seed: "fixture-solo-seed",
        party: [{ species: 25, level: 10, hp: 30, maxHp: 30 }],
        modifiers: [],
        money: 321,
        pokeballCounts: { POKEBALL: 2 },
      },
    },
    schema,
  );
  const legacyV1 = {
    version: schema.replay_trace.supported_versions[0],
    seed: "fixture-v1-seed",
    gameModeId: classicMode,
    difficulty: "youngster",
    challenges: [],
    roster: [{ species: 1 }],
    events: [],
  };
  const invalid = {
    version: 99,
    seed: "",
    gameModeId: classicMode,
    difficulty: "youngster",
    challenges: [],
    roster: [],
    events: [
      { type: "command", wave: 1.5, turn: 0, slotFieldIndex: 0, command: { kind: "unknown" } },
      { type: "interaction", seq: "bad", kind: 3, choice: "bad" },
      { type: "future" },
    ],
    coop: {},
    checkpoint: { wave: 1.5, seed: "", party: [] },
  };
  const fixtures = [
    { id: "valid-coop-v2", trace: validCoop },
    { id: "valid-single-player-v2-with-end-state", trace: validSingle },
    { id: "valid-legacy-v1", trace: legacyV1 },
    { id: "invalid-structure", trace: invalid },
  ].map(fixture => ({
    ...fixture,
    validation: validateReplayTrace(fixture.trace, schema.replay_trace.supported_versions),
  }));
  return {
    source_file: schema.source_files.replayTrace,
    canonical_algorithms: ["makeReplayTrace", "validateReplayTrace"],
    trace_version: schema.replay_trace.version,
    supported_versions: schema.replay_trace.supported_versions,
    fixtures,
  };
}

function buildInputMapPayload(schema) {
  const configs = schema.input_maps.configs;
  assert(configs.length === 6, `expected six source input configs, found ${configs.length}`);
  assert(
    configs.some(config => config.id === "keyboard")
      && configs.some(config => config.id === "pad-generic")
      && configs.some(config => config.id === "pad-dualshock")
      && configs.some(config => config.id === "pad-procon")
      && configs.some(config => config.id === "pad-unlicensed-snes")
      && configs.some(config => config.id === "pad-xbox360"),
    "input config extraction is incomplete",
  );
  return {
    source_file: schema.source_files.inputController,
    dispatcher: {
      keyboard_source: schema.source_files.keyboardConfig,
      gamepad_selection_source: schema.source_files.inputController,
      fallback_config: schema.input_maps.fallback_config,
    },
    dev_mode_source: schema.input_maps.dev_mode_expression,
    configs,
  };
}

function buildButtonPayload(schema) {
  const members = schema.buttons.members;
  assertUnique(
    members.map(member => member.name),
    "Button names",
  );
  assertUnique(
    members.map(member => member.value),
    "Button numeric values",
  );
  return {
    source_file: schema.source_files.buttons,
    enum: schema.buttons.enum,
    members,
    by_name: Object.fromEntries(members.map(member => [member.name, member.value])),
    by_value: Object.fromEntries(members.map(member => [String(member.value), member.name])),
  };
}

function buildProtocolPayload(schema) {
  assert(
    schema.protocol.pairing_version === EXPECTED_PROTOCOL_VERSION,
    `protocol version drifted from ${EXPECTED_PROTOCOL_VERSION}`,
  );
  return {
    pairing: {
      source_file: schema.source_files.coopTransport,
      constant: "COOP_PROTOCOL_VERSION",
      value: schema.protocol.pairing_version,
    },
    authority_frame: {
      source_file: schema.source_files.frameCodec,
      protocol_constant: "COOP_FRAME_PROTOCOL_VERSION",
      protocol_version: schema.protocol.authority_frame_protocol_version,
      frame_types: schema.protocol.authority_frame_types,
    },
  };
}

function buildAuthorityKindsPayload(schema) {
  assert(schema.authority_v2.entry_kinds.length === 6, "Authority V2 entry-kind extraction is incomplete");
  assert(schema.authority_v2.next_control_kinds.length === 5, "Authority V2 next-control extraction is incomplete");
  assert(schema.authority_v2.ack_stages.length === 4, "Authority V2 ACK-stage extraction is incomplete");
  return {
    source_file: schema.source_files.authorityContract,
    entry_kinds: schema.authority_v2.entry_kinds,
    ack_stages: schema.authority_v2.ack_stages,
    next_control_kinds: schema.authority_v2.next_control_kinds,
    authority_entry_validator_source: schema.source_files.authorityEntry,
    protocol_validator_source: schema.source_files.protocolValidator,
  };
}

function buildFixtureFiles(schema) {
  const files = [
    {
      file: "schema.json",
      source_file: "scripts/export-kernel-schema.mjs",
      payload: schema,
    },
    {
      file: "buttons.json",
      source_file: schema.source_files.buttons,
      payload: buildButtonPayload(schema),
    },
    {
      file: "protocol.json",
      source_file: schema.source_files.coopTransport,
      payload: buildProtocolPayload(schema),
    },
    {
      file: "authority-entry-kinds.json",
      source_file: schema.source_files.authorityContract,
      payload: buildAuthorityKindsPayload(schema),
    },
    {
      file: "next-controls.json",
      source_file: schema.source_files.nextControl,
      payload: buildNextControlPayload(schema),
    },
    {
      file: "receipts.json",
      source_file: schema.source_files.authorityContract,
      payload: buildReceiptPayload(schema),
    },
    {
      file: "checkpoints.json",
      source_file: schema.source_files.checkpoint,
      payload: buildCheckpointPayload(schema),
    },
    {
      file: "replay-traces.json",
      source_file: schema.source_files.replayTrace,
      payload: buildReplayPayload(schema),
    },
    {
      file: "input-maps.json",
      source_file: schema.source_files.inputController,
      payload: buildInputMapPayload(schema),
    },
  ];
  for (const fixture of files) {
    fixture.envelope = makeEnvelope(fixture.payload, fixture.source_file, FIXTURE_DIGEST_KIND);
  }
  return files;
}

function assertCompleteness(schema, files) {
  const names = new Set(files.map(file => file.file));
  for (const required of [
    "schema.json",
    "buttons.json",
    "protocol.json",
    "authority-entry-kinds.json",
    "next-controls.json",
    "receipts.json",
    "checkpoints.json",
    "replay-traces.json",
    "input-maps.json",
  ]) {
    assert(names.has(required), `required fixture file ${required} was not generated`);
  }
  assert(schema.buttons.members.length === 18, "Button enum fixture is incomplete");
  assert(schema.protocol.authority_frame_types.length === 8, "Authority V2 frame type fixture is incomplete");
  assert(schema.authority_v2.entry_kinds.length === 6, "Authority V2 entry-kind fixture is incomplete");
  assert(schema.authority_v2.next_control_kinds.length === 5, "next-control fixture is incomplete");
  assert(schema.authority_v2.ack_stages.length === 4, "receipt fixture is incomplete");
  const nextControls = files.find(file => file.file === "next-controls.json").payload.fixtures;
  assert(
    new Set(nextControls.map(fixture => fixture.control.kind)).size === 5,
    "next-control fixtures miss a control kind",
  );
  const checkpointFixtures = files.find(file => file.file === "checkpoints.json").payload.fixtures;
  assert(checkpointFixtures.length === 3, "checkpoint fixture set is incomplete");
  const replayFixtures = files.find(file => file.file === "replay-traces.json").payload.fixtures;
  assert(replayFixtures.length === 4, "ReplayTrace fixture set is incomplete");
  assert(
    replayFixtures.filter(fixture => fixture.validation.ok).length === 3,
    "ReplayTrace valid fixtures are incomplete",
  );
  assert(
    replayFixtures.some(fixture => !fixture.validation.ok),
    "ReplayTrace invalid fixture is missing",
  );
}

function buildManifest(files) {
  return {
    manifest_version: 1,
    digest_kind: FIXTURE_DIGEST_KIND,
    digest_definition: files[0].envelope.digest_definition,
    fixtures: files
      .map(file => ({
        fixture_file: `${FIXTURE_DIRECTORY}/${file.file}`,
        source_file: file.envelope.source_file,
        digest_kind: file.envelope.digest_kind,
        digest_definition: file.envelope.digest_definition,
        canonical_digest: file.envelope.canonical_digest,
      }))
      .sort((left, right) => left.fixture_file.localeCompare(right.fixture_file)),
  };
}

export function exportFixtures(root = ROOT) {
  verifyOracleSha(root);
  const schema = buildSchema(root);
  const files = buildFixtureFiles(schema);
  assertCompleteness(schema, files);
  for (const file of files) {
    writeJson(root, join(FIXTURE_DIRECTORY, file.file), file.envelope);
  }
  const manifestPayload = buildManifest(files);
  writeJson(
    root,
    join(FIXTURE_DIRECTORY, "manifest.json"),
    makeEnvelope(manifestPayload, "scripts/export-kernel-fixtures.mjs", FIXTURE_DIGEST_KIND),
  );
  return { files: files.map(file => file.file), manifest: "manifest.json", oracle_game_sha: ORACLE_GAME_SHA };
}

function isMainModule() {
  return process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  exportFixtures(ROOT);
}
