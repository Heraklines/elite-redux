// =============================================================================
// AUTO-GENERATED then HAND-MAINTAINED. Source: vendor/elite-redux/v2.65beta.json
//
// ⚠️  DO NOT blindly `pnpm run er:classify-abilities` over this file. It carries
//     hand-applied fixups that a regeneration would clobber:
//       • This table was RE-KEYED to the current er-abilities draft ids after
//         commit cfd9c8d realigned 81 draft ids to the v2.65 JSON positions
//         (the classifier had keyed by the pre-realignment ids, so every drifted
//         ability — Marine Apex 390, Lightsaber 909, Lucha Libre 985, … — was
//         silently wired with a NEIGHBOUR ability's archetype). Keys + the
//         `erAbilityId` field now match `er-abilities.ts`/`er-id-map.ts`.
//       • 21 chance-status rows carry a manual `direction:"offense"`/`"both"`
//         annotation (+ C-source line refs) that the classifier does not emit.
//       • Embody Aspect 795-798 entry-effect rows (the generator collapsed the
//         four variants to one id; 796-798 are constructed from synthetic
//         drafts — see init-elite-redux-custom-abilities.ts).
//     If you DO regenerate, re-apply the above and re-run the er-composite-riders
//     + er-offensive-chance-status harness tests before committing.
// =============================================================================

// Phase C task C2: auto-classified ER abilities → archetype primitives.
//
// This table maps each ER-custom ability id to the archetype primitive that
// implements it, plus a JSON-serializable `params` object the wiring step
// will feed to the primitive's constructor. `archetype: "bespoke"` means
// the ability didn't match any archetype shape and will need a hand-written
// implementation (the "long tail" of ~280 abilities per the taxonomy doc).
//
// Regenerate with: `pnpm run er:classify-abilities`.

export type ErArchetypeKind =
  | "type-damage-boost"
  | "flag-damage-boost"
  | "priority-modifier"
  | "entry-effect"
  | "chance-status-on-hit"
  | "crit-mod"
  | "damage-reduction-generic"
  | "passive-recovery"
  | "lifesteal"
  | "stat-trigger-on-event"
  | "type-conversion"
  | "type-resist-or-absorb"
  | "type-effectiveness-override"
  | "composite-vanilla-mashup"
  | "weather-or-terrain-interaction"
  | "multi-hit-override"
  | "accuracy-mod"
  | "proc-followup-attack"
  | "on-hit-counter-attack"
  | "status-immunity"
  | "conditional-damage"
  | "form-change"
  | "move-replacement"
  | "bespoke";

export interface ErAbilityArchetypeEntry {
  readonly erAbilityId: number;
  readonly archetype: ErArchetypeKind;
  readonly params: Record<string, unknown> | null;
}

export const ER_ABILITY_ARCHETYPES: Readonly<Record<number, ErAbilityArchetypeEntry>> = {
  0: { erAbilityId: 0, archetype: "bespoke", params: null },
  226: { erAbilityId: 226, archetype: "entry-effect", params: {"effect":{"kind":"set-terrain","terrain":"ELECTRIC","turns":8}} },
  254: { erAbilityId: 254, archetype: "bespoke", params: null },
  261: { erAbilityId: 261, archetype: "bespoke", params: null },
  264: { erAbilityId: 264, archetype: "stat-trigger-on-event", params: {"trigger":"on-ko","stats":[{"stat":"ATK","stages":1}]} },
  266: { erAbilityId: 266, archetype: "bespoke", params: null }, // As One (Ice Rider): Unnerve + Chilling Neigh, block ALL held items not just berries — see dispatchBespoke
  267: { erAbilityId: 267, archetype: "bespoke", params: null }, // As One (Shadow Rider): Unnerve + Grim Neigh, block ALL held items not just berries — see dispatchBespoke
  268: { erAbilityId: 268, archetype: "bespoke", params: null },
  269: { erAbilityId: 269, archetype: "bespoke", params: null },
  270: { erAbilityId: 270, archetype: "bespoke", params: null },
  271: { erAbilityId: 271, archetype: "bespoke", params: null },
  272: { erAbilityId: 272, archetype: "damage-reduction-generic", params: {"filter":{"kind":"special"},"reduction":0.3} },
  273: { erAbilityId: 273, archetype: "bespoke", params: null },
  274: { erAbilityId: 274, archetype: "type-conversion", params: {"sourceType":"NORMAL","targetType":"GROUND","multiplier":1.2,"flag":"SOUND_BASED"} },
  275: { erAbilityId: 275, archetype: "bespoke", params: null },
  276: { erAbilityId: 276, archetype: "bespoke", params: null },
  277: { erAbilityId: 277, archetype: "priority-modifier", params: {"condition":{"kind":"max-hp"},"priority":1,"filter":{"flag":"PUNCHING_MOVE"}} },
  278: { erAbilityId: 278, archetype: "bespoke", params: null },
  279: { erAbilityId: 279, archetype: "bespoke", params: null },
  280: { erAbilityId: 280, archetype: "type-conversion", params: {"sourceType":"ROCK","targetType":"ICE","multiplier":1.1} },
  281: { erAbilityId: 281, archetype: "type-damage-boost", params: {"type":"ELECTRIC","multiplier":1.25} },
  282: { erAbilityId: 282, archetype: "bespoke", params: null },
  283: { erAbilityId: 283, archetype: "bespoke", params: null },
  284: { erAbilityId: 284, archetype: "bespoke", params: null },
  285: { erAbilityId: 285, archetype: "bespoke", params: null },
  286: { erAbilityId: 286, archetype: "bespoke", params: null },
  287: { erAbilityId: 287, archetype: "bespoke", params: null },
  288: { erAbilityId: 288, archetype: "bespoke", params: null },
  289: { erAbilityId: 289, archetype: "bespoke", params: null },
  290: { erAbilityId: 290, archetype: "stat-trigger-on-event", params: {"trigger":"on-hit","stats":[{"stat":"DEF","stages":1},{"stat":"SPDEF","stages":1}],"filter":{"types":["FLYING","FIRE"]}} },
  291: { erAbilityId: 291, archetype: "bespoke", params: null },
  292: { erAbilityId: 292, archetype: "bespoke", params: null },
  293: { erAbilityId: 293, archetype: "bespoke", params: null },
  294: { erAbilityId: 294, archetype: "entry-effect", params: {"effect":{"kind":"add-self-type","type":"WATER"}} },
  295: { erAbilityId: 295, archetype: "chance-status-on-hit", params: {"chance":50,"status":"CONFUSION","filter":{"flag":"SOUND_BASED"},"direction":"offense"} }, // Loud Bang: holder's SOUND move confuses the foe (C-source attacker block ~9316)
  296: { erAbilityId: 296, archetype: "bespoke", params: null }, // Lead Coat: 40% physical damage reduction AND 0.9x Speed (composite — see dispatchBespoke)
  297: { erAbilityId: 297, archetype: "bespoke", params: null },
  298: { erAbilityId: 298, archetype: "entry-effect", params: {"effect":{"kind":"add-self-type","type":"GROUND"}} },
  299: { erAbilityId: 299, archetype: "bespoke", params: null },
  300: { erAbilityId: 300, archetype: "bespoke", params: null }, // Fighting Spirit: Normal→Fighting + conditional Fighting STAB / screen-break (dispatchBespoke, mirrors Tectonize 308 / Qigong 762)
  301: { erAbilityId: 301, archetype: "bespoke", params: null },
  302: { erAbilityId: 302, archetype: "bespoke", params: null },
  303: { erAbilityId: 303, archetype: "bespoke", params: null }, // Fossilized: Rock +20% offense AND halves Rock dmg taken (composite — see dispatchBespoke)
  304: { erAbilityId: 304, archetype: "bespoke", params: null },
  305: { erAbilityId: 305, archetype: "conditional-damage", params: {"condition":{"kind":"any-active-asleep"},"multiplier":2} }, // Dreamcatcher: 2x when ANY active mon asleep (user/ally/opponent), not just target
  306: { erAbilityId: 306, archetype: "bespoke", params: null }, // Nocturnal: Dark moves +1.25x AND -25% dmg from Dark/Fairy (composite — see dispatchBespoke)
  307: { erAbilityId: 307, archetype: "passive-recovery", params: {"healFraction":0.0625} },
  308: { erAbilityId: 308, archetype: "bespoke", params: null }, // Tectonize: Normal->Ground + conditional Ground STAB / Ground-type SR+Spikes immunity (see dispatchBespoke)
  309: { erAbilityId: 309, archetype: "entry-effect", params: {"effect":{"kind":"add-self-type","type":"ICE"}} },
  310: { erAbilityId: 310, archetype: "entry-effect", params: {"effect":{"kind":"add-self-type","type":"DRAGON"}} },
  311: { erAbilityId: 311, archetype: "bespoke", params: null }, // Liquified: 1/2 contact dmg AND takes 2x from Water moves (composite — see dispatchBespoke)
  312: { erAbilityId: 312, archetype: "bespoke", params: null }, // Dragonfly: add Dragon type on entry AND Ground immunity (composite — see dispatchBespoke)
  313: { erAbilityId: 313, archetype: "bespoke", params: null },
  314: { erAbilityId: 314, archetype: "bespoke", params: null },
  315: { erAbilityId: 315, archetype: "bespoke", params: null }, // Hydrate — hand-wired (Normal->Water + conditional Water STAB / 10% drench); see dispatchBespoke
  316: { erAbilityId: 316, archetype: "entry-effect", params: {"effect":{"kind":"add-self-type","type":"STEEL"}} },
  317: { erAbilityId: 317, archetype: "damage-reduction-generic", params: {"filter":{"kind":"super-effective"},"reduction":0.35} },
  318: { erAbilityId: 318, archetype: "damage-reduction-generic", params: {"filter":{"kind":"super-effective"},"reduction":0.5} },
  319: { erAbilityId: 319, archetype: "multi-hit-override", params: {"filter":{"kind":"flag","flag":"PUNCHING_MOVE"},"hits":2,"secondaryHitMultiplier":0.4} },
  320: { erAbilityId: 320, archetype: "bespoke", params: null },
  321: { erAbilityId: 321, archetype: "bespoke", params: null },
  322: { erAbilityId: 322, archetype: "type-damage-boost", params: {"type":"ELECTRIC","multiplier":1.2,"lowHpMultiplier":1.5,"lowHpThreshold":0.3333333333333333} },
  323: { erAbilityId: 323, archetype: "bespoke", params: null },
  324: { erAbilityId: 324, archetype: "entry-effect", params: {"effect":{"kind":"add-self-type","type":"GHOST"}} },
  325: { erAbilityId: 325, archetype: "bespoke", params: null },
  326: { erAbilityId: 326, archetype: "bespoke", params: null },
  327: { erAbilityId: 327, archetype: "bespoke", params: null },
  328: { erAbilityId: 328, archetype: "bespoke", params: null }, // Overwhelm: Dragon hits Fairy for neutral AND immune to Intimidate/Scare (composite — see dispatchBespoke)
  329: { erAbilityId: 329, archetype: "bespoke", params: null },
  330: { erAbilityId: 330, archetype: "bespoke", params: null },
  331: { erAbilityId: 331, archetype: "lifesteal", params: {"trigger":"on-ko","healFraction":0.25} },
  332: { erAbilityId: 332, archetype: "bespoke", params: null },
  333: { erAbilityId: 333, archetype: "bespoke", params: null },
  334: { erAbilityId: 334, archetype: "bespoke", params: null },
  335: { erAbilityId: 335, archetype: "bespoke", params: null },
  336: { erAbilityId: 336, archetype: "type-damage-boost", params: {"type":"ELECTRIC","multiplier":1.35,"recoilPct":0.1} },
  337: { erAbilityId: 337, archetype: "bespoke", params: null }, // Raw Wood: Grass +20% offense AND halves Grass dmg taken (composite — see dispatchBespoke)
  338: { erAbilityId: 338, archetype: "chance-status-on-hit", params: {"chance":50,"status":"TOXIC","filter":{"flag":"STRONG_JAW"},"direction":"offense"} }, // Solenoglyphs: holder's BITING move badly poisons target (C-source attacker block ~9524)
  // Spider Lair — "Sets Sticky Web on the OPPONENT's field. Lasts 5 turns,
  // unremovable." Mechanically identical to Foamy Web (949): use the dedicated
  // FOAMY_WEB hazard on the foe side (5-turn, absent from Rapid Spin/Defog lists).
  // Was STICKY_WEB with no side → laid a permanent, removable web on BOTH sides.
  339: { erAbilityId: 339, archetype: "entry-effect", params: {"effect":{"kind":"set-hazard","hazard":"FOAMY_WEB","side":"foe","layers":1}} },
  340: { erAbilityId: 340, archetype: "bespoke", params: null },
  341: { erAbilityId: 341, archetype: "bespoke", params: null },
  342: { erAbilityId: 342, archetype: "bespoke", params: null },
  343: { erAbilityId: 343, archetype: "type-damage-boost", params: {"type":"PSYCHIC","multiplier":1.2,"lowHpMultiplier":1.5,"lowHpThreshold":0.3333333333333333} },
  344: { erAbilityId: 344, archetype: "bespoke", params: null }, // Poison Absorb: absorb Poison moves (heal 25%) AND heal 1/8 each turn on Toxic Terrain (composite — see dispatchBespoke)
  345: { erAbilityId: 345, archetype: "bespoke", params: null },
  346: { erAbilityId: 346, archetype: "entry-effect", params: {"effect":{"kind":"set-screen-or-room","tag":"TRICK_ROOM","turns":3}} },
  347: { erAbilityId: 347, archetype: "bespoke", params: null },
  348: { erAbilityId: 348, archetype: "bespoke", params: null },
  349: { erAbilityId: 349, archetype: "bespoke", params: null },
  350: { erAbilityId: 350, archetype: "bespoke", params: null },
  351: { erAbilityId: 351, archetype: "priority-modifier", params: {"condition":{"kind":"max-hp"},"priority":1,"filter":{"type":"FIRE"}} },
  352: { erAbilityId: 352, archetype: "bespoke", params: null },
  353: { erAbilityId: 353, archetype: "bespoke", params: null },
  354: { erAbilityId: 354, archetype: "bespoke", params: null },
  355: { erAbilityId: 355, archetype: "bespoke", params: null },
  356: { erAbilityId: 356, archetype: "bespoke", params: null },
  357: { erAbilityId: 357, archetype: "bespoke", params: null },
  358: { erAbilityId: 358, archetype: "multi-hit-override", params: {"filter":{"kind":"all"},"hits":2,"secondaryHitMultiplier":0.25} },
  359: { erAbilityId: 359, archetype: "type-damage-boost", params: {"type":"FLYING","multiplier":1.2,"lowHpMultiplier":1.5,"lowHpThreshold":0.3333333333333333} },
  360: { erAbilityId: 360, archetype: "bespoke", params: null },
  361: { erAbilityId: 361, archetype: "flag-damage-boost", params: {"flag":"KICKING_MOVE","multiplier":1.3} },
  362: { erAbilityId: 362, archetype: "priority-modifier", params: {"condition":{"kind":"max-hp"},"priority":1,"filter":{"type":"ICE"}} },
  363: { erAbilityId: 363, archetype: "lifesteal", params: {"trigger":"on-ko","healFraction":0.25} },
  364: { erAbilityId: 364, archetype: "lifesteal", params: {"trigger":"on-ko","healFraction":0.25} },
  365: { erAbilityId: 365, archetype: "bespoke", params: null },
  366: { erAbilityId: 366, archetype: "composite-vanilla-mashup", params: {"parts":["Chloroplast","Immolate"]} },
  367: { erAbilityId: 367, archetype: "bespoke", params: null },
  368: { erAbilityId: 368, archetype: "bespoke", params: null },
  369: { erAbilityId: 369, archetype: "bespoke", params: null },
  371: { erAbilityId: 371, archetype: "flag-damage-boost", params: {"flag":"AIR_BASED","multiplier":1.3} },
  372: { erAbilityId: 372, archetype: "bespoke", params: null },
  373: { erAbilityId: 373, archetype: "bespoke", params: null },
  374: { erAbilityId: 374, archetype: "composite-vanilla-mashup", params: {"parts":["Chloroplast","Chlorophyll","Leaf Guard","Harvest","Solar Power"]} },
  375: { erAbilityId: 375, archetype: "bespoke", params: null },
  376: { erAbilityId: 376, archetype: "bespoke", params: null },
  377: { erAbilityId: 377, archetype: "bespoke", params: null },
  378: { erAbilityId: 378, archetype: "bespoke", params: null },
  379: { erAbilityId: 379, archetype: "type-resist-or-absorb", params: {"type":"ICE","effect":{"kind":"absorb","redirect":true,"statBoost":{"highestAttack":true,"stages":1}}} }, // Ice Dew: Ice absorb boosts HIGHEST attacking stat (ATK vs SpAtk), not fixed ATK — mirror Heat Sink 865
  380: { erAbilityId: 380, archetype: "bespoke", params: null },
  381: { erAbilityId: 381, archetype: "bespoke", params: null },
  382: { erAbilityId: 382, archetype: "bespoke", params: null },
  383: { erAbilityId: 383, archetype: "bespoke", params: null },
  384: { erAbilityId: 384, archetype: "bespoke", params: null },
  385: { erAbilityId: 385, archetype: "bespoke", params: null }, // Nosferatu: contact moves +20% dmg AND heal 1/2 of dmg dealt (composite — see dispatchBespoke)
  393: { erAbilityId: 393, archetype: "bespoke", params: null }, // Spectralize — hand-wired Ghost analog of Hydrate (Normal->Ghost + conditional Ghost STAB / 10% fear); see dispatchBespoke
  386: { erAbilityId: 386, archetype: "bespoke", params: null }, // Spectral Shroud: Spectralize (Normal→Ghost +1.2x) AND moves 30% badly-poison (composite — see dispatchBespoke)
  387: { erAbilityId: 387, archetype: "bespoke", params: null }, // Discipline: immune to confusion + Intimidate/Scare (CONFUSION isn't a vanilla StatusEffect — needs BattlerTagImmunity; see dispatchBespoke)
  388: { erAbilityId: 388, archetype: "bespoke", params: null },
  389: { erAbilityId: 389, archetype: "composite-vanilla-mashup", params: {"parts":["50% more damage to Water-types","Infiltrator"]} },
  390: { erAbilityId: 390, archetype: "flag-damage-boost", params: {"flag":"MIGHTY_HORN","multiplier":1.3} },
  391: { erAbilityId: 391, archetype: "bespoke", params: null },
  392: { erAbilityId: 392, archetype: "damage-reduction-generic", params: {"filter":{"kind":"all"},"reduction":0.35} },
  394: { erAbilityId: 394, archetype: "bespoke", params: null },
  395: { erAbilityId: 395, archetype: "composite-vanilla-mashup", params: {"parts":["Mega Launcher","Sighting System"]} },
  396: { erAbilityId: 396, archetype: "bespoke", params: null },
  397: { erAbilityId: 397, archetype: "bespoke", params: null },
  398: { erAbilityId: 398, archetype: "bespoke", params: null },
  399: { erAbilityId: 399, archetype: "bespoke", params: null }, // Parry: 20% all-damage reduction AND counters contact with 20 BP Mach Punch (composite — see dispatchBespoke)
  400: { erAbilityId: 400, archetype: "bespoke", params: null },
  401: { erAbilityId: 401, archetype: "bespoke", params: null },
  403: { erAbilityId: 403, archetype: "bespoke", params: null },
  404: { erAbilityId: 404, archetype: "bespoke", params: null }, // Mineralize: Normal->Rock -ate + conditional 10% ER_BLEED (Rock holder) / Rock STAB (see dispatchBespoke)
  405: { erAbilityId: 405, archetype: "bespoke", params: null },
  406: { erAbilityId: 406, archetype: "bespoke", params: null },
  407: { erAbilityId: 407, archetype: "bespoke", params: null },
  408: { erAbilityId: 408, archetype: "bespoke", params: null }, // Fearmonger: Intimidate+Scare on entry (ATK+SpAtk -1 to foes) AND 10% fear on contact (composite — see dispatchBespoke)
  409: { erAbilityId: 409, archetype: "stat-trigger-on-event", params: {"trigger":"on-stat-lowered","scope":"side","stats":[{"stat":"ATK","stages":1},{"stat":"DEF","stages":1}]} }, // King's Wrath: "Lowering any stats on its side raises Atk and Def" (holder + ally, once per stat)
  410: { erAbilityId: 410, archetype: "stat-trigger-on-event", params: {"trigger":"on-stat-lowered","scope":"side","stats":[{"stat":"SPATK","stages":1},{"stat":"SPDEF","stages":1}]} }, // Queen's Mourning: "Lowering any stats on its side raises SpAtk and SpDef" (holder + ally, once per stat)
  411: { erAbilityId: 411, archetype: "bespoke", params: null },
  412: { erAbilityId: 412, archetype: "bespoke", params: null },
  413: { erAbilityId: 413, archetype: "bespoke", params: null }, // Draconize: Normal->Dragon + conditional Dragon STAB / Dragon-type-holder Dragon-vs-Fairy neutral (see dispatchBespoke)
  414: { erAbilityId: 414, archetype: "conditional-damage", params: {"condition":{"kind":"target-has-lowered-stat"},"multiplier":1.5} },
  415: { erAbilityId: 415, archetype: "composite-vanilla-mashup", params: {"parts":["Self Sufficient","Natural Cure"]} },
  416: { erAbilityId: 416, archetype: "composite-vanilla-mashup", params: {"parts":["Electromorphosis","Galvanize"]} },
  417: { erAbilityId: 417, archetype: "type-damage-boost", params: {"type":"FIRE","multiplier":1.3,"lowHpMultiplier":1.8,"lowHpThreshold":0.3333333333333333} },
  418: { erAbilityId: 418, archetype: "type-damage-boost", params: {"type":"WATER","multiplier":1.3,"lowHpMultiplier":1.8,"lowHpThreshold":0.3333333333333333} },
  419: { erAbilityId: 419, archetype: "type-damage-boost", params: {"type":"GRASS","multiplier":1.3,"lowHpMultiplier":1.8,"lowHpThreshold":0.3333333333333333} },
  420: { erAbilityId: 420, archetype: "multi-hit-override", params: {"filter":{"kind":"flag","flag":"BITING_MOVE"},"hits":2,"secondaryHitMultiplier":0.4} },
  421: { erAbilityId: 421, archetype: "bespoke", params: null },
  422: { erAbilityId: 422, archetype: "bespoke", params: null },
  423: { erAbilityId: 423, archetype: "bespoke", params: null },
  424: { erAbilityId: 424, archetype: "bespoke", params: null },
  425: { erAbilityId: 425, archetype: "bespoke", params: null },
  426: { erAbilityId: 426, archetype: "bespoke", params: null },
  427: { erAbilityId: 427, archetype: "bespoke", params: null },
  428: { erAbilityId: 428, archetype: "bespoke", params: null },
  429: { erAbilityId: 429, archetype: "bespoke", params: null },
  430: { erAbilityId: 430, archetype: "priority-modifier", params: {"condition":{"kind":"max-hp"},"priority":1,"filter":{"type":"ELECTRIC"}} },
  431: { erAbilityId: 431, archetype: "bespoke", params: null },
  432: { erAbilityId: 432, archetype: "type-damage-boost", params: {"type":"FIRE","multiplier":1.35,"recoilPct":0.05} },
  433: { erAbilityId: 433, archetype: "bespoke", params: null }, // Dual Wield: Mega Launcher AND Keen Edge moves hit twice, both hits 70% (composite — see dispatchBespoke)
  434: { erAbilityId: 434, archetype: "bespoke", params: null },
  435: { erAbilityId: 435, archetype: "bespoke", params: null },
  436: { erAbilityId: 436, archetype: "entry-effect", params: {"effect":{"kind":"set-screen-or-room","tag":"GRAVITY","turns":8}} },
  437: { erAbilityId: 437, archetype: "bespoke", params: null },
  438: { erAbilityId: 438, archetype: "bespoke", params: null },
  439: { erAbilityId: 439, archetype: "bespoke", params: null },
  440: { erAbilityId: 440, archetype: "bespoke", params: null }, // Prismatic Fur — bespoke: Color Change re-timed to a PRE-hit resist swap (see dispatchBespoke case 440)
  441: { erAbilityId: 441, archetype: "chance-status-on-hit", params: {"chance":50,"status":"PARALYSIS","filter":{"flag":"STRONG_JAW"},"direction":"offense"} }, // Shocking Jaws: holder's BITING move paralyzes target (C-source attacker block ~9536)
  442: { erAbilityId: 442, archetype: "bespoke", params: null },
  443: { erAbilityId: 443, archetype: "entry-effect", params: {"effect":{"kind":"set-screen-or-room","tag":"GRAVITY","turns":5}} },
  444: { erAbilityId: 444, archetype: "bespoke", params: null },
  445: { erAbilityId: 445, archetype: "bespoke", params: null },
  447: { erAbilityId: 447, archetype: "bespoke", params: null },
  452: { erAbilityId: 452, archetype: "entry-effect", params: {"effect":{"kind":"add-self-type","type":"FAIRY"}} },
  453: { erAbilityId: 453, archetype: "multi-hit-override", params: {"filter":{"kind":"type","type":"FIRE"},"hits":2,"allHitsMultiplier":0.7} },
  454: { erAbilityId: 454, archetype: "stat-trigger-on-event", params: {"trigger":"on-ko","stats":[{"stat":"SPD","stages":1}]} },
  455: { erAbilityId: 455, archetype: "bespoke", params: null },
  456: { erAbilityId: 456, archetype: "bespoke", params: null },
  457: { erAbilityId: 457, archetype: "bespoke", params: null },
  458: { erAbilityId: 458, archetype: "type-damage-boost", params: {"type":"GHOST","multiplier":1.3,"lowHpMultiplier":1.8,"lowHpThreshold":0.3333333333333333} },
  459: { erAbilityId: 459, archetype: "bespoke", params: null },
  460: { erAbilityId: 460, archetype: "composite-vanilla-mashup", params: {"parts":["Technician","Skill Link"]} },
  461: { erAbilityId: 461, archetype: "bespoke", params: null },
  462: { erAbilityId: 462, archetype: "bespoke", params: null }, // Combat Specialist: punching AND kicking +30% — the flag-damage-boost row only covered PUNCHING; bespoke case wires both (see dispatchBespoke)
  463: { erAbilityId: 463, archetype: "bespoke", params: null },
  464: { erAbilityId: 464, archetype: "bespoke", params: null },
  465: { erAbilityId: 465, archetype: "bespoke", params: null }, // Pixie Power: field-wide Fairy +1.33x (Fairy-Aura style, Aura-Break-affected) AND 1.2x accuracy (composite — see dispatchBespoke)
  466: { erAbilityId: 466, archetype: "bespoke", params: null },
  467: { erAbilityId: 467, archetype: "composite-vanilla-mashup", params: {"parts":["Predator","Molten Down"]} },
  468: { erAbilityId: 468, archetype: "bespoke", params: null },
  469: { erAbilityId: 469, archetype: "composite-vanilla-mashup", params: {"parts":["Iron fist","Water moves function normally under sun"]} },
  470: { erAbilityId: 470, archetype: "flag-damage-boost", params: {"flag":"ARROW","multiplier":1.3} },
  471: { erAbilityId: 471, archetype: "bespoke", params: null },
  472: { erAbilityId: 472, archetype: "flag-damage-boost", params: {"flag":"HAMMER_BASED","multiplier":1.3} },
  473: { erAbilityId: 473, archetype: "bespoke", params: null },
  474: { erAbilityId: 474, archetype: "bespoke", params: null },
  475: { erAbilityId: 475, archetype: "bespoke", params: null },
  476: { erAbilityId: 476, archetype: "bespoke", params: null },
  477: { erAbilityId: 477, archetype: "bespoke", params: null },
  478: { erAbilityId: 478, archetype: "bespoke", params: null },
  479: { erAbilityId: 479, archetype: "bespoke", params: null },
  480: { erAbilityId: 480, archetype: "composite-vanilla-mashup", params: {"parts":["Tipping Point","Rampage"]} },
  481: { erAbilityId: 481, archetype: "bespoke", params: null },
  482: { erAbilityId: 482, archetype: "bespoke", params: null },
  483: { erAbilityId: 483, archetype: "composite-vanilla-mashup", params: {"parts":["Natural Cure","Regenerator"]} },
  485: { erAbilityId: 485, archetype: "bespoke", params: null },
  486: { erAbilityId: 486, archetype: "composite-vanilla-mashup", params: {"parts":["Wonder Skin","Cute Charm"]} },
  487: { erAbilityId: 487, archetype: "bespoke", params: null },
  488: { erAbilityId: 488, archetype: "bespoke", params: null },
  489: { erAbilityId: 489, archetype: "composite-vanilla-mashup", params: {"parts":["Emanate","Inner Focus"]} },
  490: { erAbilityId: 490, archetype: "composite-vanilla-mashup", params: {"parts":["Sweet Dreams","Self Sufficient"]} },
  491: { erAbilityId: 491, archetype: "bespoke", params: null },
  492: { erAbilityId: 492, archetype: "bespoke", params: null },
  493: { erAbilityId: 493, archetype: "composite-vanilla-mashup", params: {"parts":["Freezing Point","triggers hail when hit"]} },
  494: { erAbilityId: 494, archetype: "bespoke", params: null },
  495: { erAbilityId: 495, archetype: "bespoke", params: null },
  496: { erAbilityId: 496, archetype: "bespoke", params: null },
  497: { erAbilityId: 497, archetype: "bespoke", params: null }, // Yuki Onna: entry Intimidate+Scare (ATK/SpAtk -1) AND 30% infatuate offensively+defensively (composite — see dispatchBespoke)
  498: { erAbilityId: 498, archetype: "bespoke", params: null },
  499: { erAbilityId: 499, archetype: "composite-vanilla-mashup", params: {"parts":["Filter","Illuminate"]} },
  500: { erAbilityId: 500, archetype: "bespoke", params: null },
  501: { erAbilityId: 501, archetype: "composite-vanilla-mashup", params: {"parts":["Hydration","Water Veil"]} },
  502: { erAbilityId: 502, archetype: "composite-vanilla-mashup", params: {"parts":["Drizzle","Swift Swim"]} },
  503: { erAbilityId: 503, archetype: "bespoke", params: null },
  504: { erAbilityId: 504, archetype: "bespoke", params: null },
  505: { erAbilityId: 505, archetype: "bespoke", params: null },
  506: { erAbilityId: 506, archetype: "bespoke", params: null },
  507: { erAbilityId: 507, archetype: "bespoke", params: null }, // Fertilize: Normal->Grass -ate + conditional 10% lifesteal (Grass holder) / Grass STAB (see dispatchBespoke)
  508: { erAbilityId: 508, archetype: "composite-vanilla-mashup", params: {"parts":["Cute Charm","heal 25% damage vs infatuated"]} },
  509: { erAbilityId: 509, archetype: "type-damage-boost", params: {"type":"FIGHTING","multiplier":1.2,"lowHpMultiplier":1.5,"lowHpThreshold":0.3333333333333333} },
  511: { erAbilityId: 511, archetype: "bespoke", params: null },
  512: { erAbilityId: 512, archetype: "type-damage-boost", params: {"type":"FIRE","multiplier":1.5} },
  513: { erAbilityId: 513, archetype: "composite-vanilla-mashup", params: {"parts":["Keen Edge","Mystic Blades"]} },
  514: { erAbilityId: 514, archetype: "bespoke", params: null },
  515: { erAbilityId: 515, archetype: "bespoke", params: null },
  516: { erAbilityId: 516, archetype: "bespoke", params: null },
  517: { erAbilityId: 517, archetype: "bespoke", params: null },
  518: { erAbilityId: 518, archetype: "bespoke", params: null },
  519: { erAbilityId: 519, archetype: "bespoke", params: null },
  520: { erAbilityId: 520, archetype: "composite-vanilla-mashup", params: {"parts":["Strong Jaw","Primal Maw"]} },
  521: { erAbilityId: 521, archetype: "bespoke", params: null },
  522: { erAbilityId: 522, archetype: "priority-modifier", params: {"condition":{"kind":"max-hp"},"priority":1,"filter":{"type":"GHOST"}} },
  523: { erAbilityId: 523, archetype: "bespoke", params: null },
  524: { erAbilityId: 524, archetype: "composite-vanilla-mashup", params: {"parts":["Amplifier","Punk Rock"]} },
  525: { erAbilityId: 525, archetype: "chance-status-on-hit", params: {"chance":50,"status":"BURN","filter":{"flag":"STRONG_JAW"},"direction":"offense"} }, // Flaming Jaws: holder's BITING move burns target (desc)
  526: { erAbilityId: 526, archetype: "bespoke", params: null },
  527: { erAbilityId: 527, archetype: "composite-vanilla-mashup", params: {"parts":["Intrepid Sword","Anger Point"]} },
  528: { erAbilityId: 528, archetype: "composite-vanilla-mashup", params: {"parts":["Dauntless Shield","Stamina"]} },
  529: { erAbilityId: 529, archetype: "bespoke", params: null },
  530: { erAbilityId: 530, archetype: "composite-vanilla-mashup", params: {"parts":["Unnerve","Grim Neigh","Chilling Neigh"]} },
  531: { erAbilityId: 531, archetype: "bespoke", params: null },
  532: { erAbilityId: 532, archetype: "bespoke", params: null },
  533: { erAbilityId: 533, archetype: "stat-trigger-on-event", params: {"trigger":"on-ko","stats":[{"stat":"SPATK","stages":1}]} },
  534: { erAbilityId: 534, archetype: "bespoke", params: null },
  536: { erAbilityId: 536, archetype: "bespoke", params: null },
  537: { erAbilityId: 537, archetype: "chance-status-on-hit", params: {"chance":30,"status":"BLEED","onContactOnly":true,"direction":"both"} }, // Spike Armor: bleed on contact (defense) or offense (desc)
  538: { erAbilityId: 538, archetype: "chance-status-on-hit", params: {"chance":30,"status":"BLEED","onContactOnly":false,"filter":{"category":"SPECIAL"}} }, // Voodoo Power — "30% bleed when hit by SPECIAL attacks" (category filter)
  539: { erAbilityId: 539, archetype: "bespoke", params: null }, // Chrome Coat: 40% special damage reduction AND 0.9x Speed (special-side twin of Lead Coat 296 — see dispatchBespoke)
  540: { erAbilityId: 540, archetype: "type-conversion", params: {"sourceType":"NORMAL","targetType":"GHOST","multiplier":1.2,"flag":"SOUND_BASED"} },
  541: { erAbilityId: 541, archetype: "bespoke", params: null },
  542: { erAbilityId: 542, archetype: "composite-vanilla-mashup", params: {"parts":["Ambush","Violent Rush"]} },
  544: { erAbilityId: 544, archetype: "bespoke", params: null },
  545: { erAbilityId: 545, archetype: "bespoke", params: null },
  546: { erAbilityId: 546, archetype: "bespoke", params: null },
  551: { erAbilityId: 551, archetype: "bespoke", params: null },
  552: { erAbilityId: 552, archetype: "bespoke", params: null },
  555: { erAbilityId: 555, archetype: "bespoke", params: null },
  556: { erAbilityId: 556, archetype: "bespoke", params: null },
  557: { erAbilityId: 557, archetype: "bespoke", params: null },
  558: { erAbilityId: 558, archetype: "priority-modifier", params: {"condition":{"kind":"max-hp"},"priority":1,"filter":{"type":"DARK"}} },
  559: { erAbilityId: 559, archetype: "bespoke", params: null },
  560: { erAbilityId: 560, archetype: "priority-modifier", params: {"condition":{"kind":"max-hp"},"priority":1,"filter":{"type":"WATER"}} },
  564: { erAbilityId: 564, archetype: "bespoke", params: null },
  // Vengeful Spirit — reclassified to bespoke: its Ghost boost is 1.3x (not
  // Vengeance's 1.2x) and its curse excludes GHOST-type attackers, neither of
  // which the auto-resolved Haunted-Spirit+Vengeance parts express. Its
  // vestigial composite-parts entry was removed (see er-composite-parts.ts).
  565: { erAbilityId: 565, archetype: "bespoke", params: null },
  568: { erAbilityId: 568, archetype: "bespoke", params: null },
  570: { erAbilityId: 570, archetype: "bespoke", params: null },
  571: { erAbilityId: 571, archetype: "damage-reduction-generic", params: {"filter":{"kind":"special"},"reduction":0.5} },
  572: { erAbilityId: 572, archetype: "entry-effect", params: {"effect":{"kind":"set-hazard","hazard":"SPIKES","layers":2}} },
  573: { erAbilityId: 573, archetype: "bespoke", params: null },
  574: { erAbilityId: 574, archetype: "bespoke", params: null },
  577: { erAbilityId: 577, archetype: "bespoke", params: null },
  582: { erAbilityId: 582, archetype: "damage-reduction-generic", params: {"filter":{"kind":"super-effective"},"reduction":0.35} },
  583: { erAbilityId: 583, archetype: "bespoke", params: null },
  585: { erAbilityId: 585, archetype: "bespoke", params: null },
  586: { erAbilityId: 586, archetype: "bespoke", params: null },
  588: { erAbilityId: 588, archetype: "bespoke", params: null },
  589: { erAbilityId: 589, archetype: "bespoke", params: null },
  590: { erAbilityId: 590, archetype: "composite-vanilla-mashup", params: {"parts":["Sweeping Edge","Keen Edge"]} },
  591: { erAbilityId: 591, archetype: "bespoke", params: null },
  592: { erAbilityId: 592, archetype: "bespoke", params: null },
  593: { erAbilityId: 593, archetype: "bespoke", params: null }, // Molten Blades: Keen Edge moves +30% AND 20% burn (composite — see dispatchBespoke)
  594: { erAbilityId: 594, archetype: "bespoke", params: null }, // Haunting Frenzy: 20% flinch AND +1 Speed on KO (composite — see dispatchBespoke)
  595: { erAbilityId: 595, archetype: "bespoke", params: null },
  596: { erAbilityId: 596, archetype: "chance-status-on-hit", params: {"chance":20,"status":"DISABLE","filter":{"flag":"SOUND_BASED"},"direction":"offense"} }, // Radio Jam: holder's SOUND move disables target (desc)
  597: { erAbilityId: 597, archetype: "bespoke", params: null },
  598: { erAbilityId: 598, archetype: "bespoke", params: null },
  599: { erAbilityId: 599, archetype: "bespoke", params: null },
  600: { erAbilityId: 600, archetype: "composite-vanilla-mashup", params: {"parts":["No guard","Dragon type moves become punching moves"]} },
  601: { erAbilityId: 601, archetype: "bespoke", params: null },
  602: { erAbilityId: 602, archetype: "bespoke", params: null },
  603: { erAbilityId: 603, archetype: "bespoke", params: null },
  604: { erAbilityId: 604, archetype: "bespoke", params: null },
  605: { erAbilityId: 605, archetype: "composite-vanilla-mashup", params: {"parts":["Unaware","Defiant"]} },
  606: { erAbilityId: 606, archetype: "composite-vanilla-mashup", params: {"parts":["Levitate","Flock"]} },
  609: { erAbilityId: 609, archetype: "bespoke", params: null },
  611: { erAbilityId: 611, archetype: "bespoke", params: null },
  612: { erAbilityId: 612, archetype: "bespoke", params: null },
  613: { erAbilityId: 613, archetype: "composite-vanilla-mashup", params: {"parts":["Fur coat","Magic Guard"]} },
  614: { erAbilityId: 614, archetype: "bespoke", params: null },
  615: { erAbilityId: 615, archetype: "composite-vanilla-mashup", params: {"parts":["Strong Jaw","Flaming Jaws"]} },
  616: { erAbilityId: 616, archetype: "bespoke", params: null },
  617: { erAbilityId: 617, archetype: "type-damage-boost", params: {"type":"ROCK","multiplier":1.2,"lowHpMultiplier":1.5,"lowHpThreshold":0.3333333333333333} },
  618: { erAbilityId: 618, archetype: "bespoke", params: null }, // Fragrant Daze: 30% confuse on contact, offensively AND defensively (composite — see dispatchBespoke)
  619: { erAbilityId: 619, archetype: "bespoke", params: null },
  620: { erAbilityId: 620, archetype: "composite-vanilla-mashup", params: {"parts":["Seaweed","Water STAB"]} },
  621: { erAbilityId: 621, archetype: "bespoke", params: null },
  622: { erAbilityId: 622, archetype: "bespoke", params: null }, // Beautiful Music: SOUND move 50% infatuate IGNORING gender (+ ER Atk/SpAtk halve) — see dispatchBespoke
  623: { erAbilityId: 623, archetype: "bespoke", params: null },
  624: { erAbilityId: 624, archetype: "type-conversion", params: {"sourceType":"NORMAL","targetType":"ICE","multiplier":1.2,"flag":"SOUND_BASED"} },
  625: { erAbilityId: 625, archetype: "bespoke", params: null },
  626: { erAbilityId: 626, archetype: "chance-status-on-hit", params: {"chance":50,"status":"BLEED","filter":{"flag":"SOUND_BASED"},"direction":"offense"} }, // Resonance: holder's SOUND moves have a 50% chance to bleed (dex)
  627: { erAbilityId: 627, archetype: "bespoke", params: null },
  628: { erAbilityId: 628, archetype: "priority-modifier", params: {"condition":{"kind":"max-hp"},"priority":1,"filter":{"type":"FAIRY"}} },
  629: { erAbilityId: 629, archetype: "bespoke", params: null },
  630: { erAbilityId: 630, archetype: "chance-status-on-hit", params: {"chance":30,"status":"FEAR","onContactOnly":true,"direction":"both"} }, // Menacing Situation: Fear on contact (defense) + offense (desc)
  631: { erAbilityId: 631, archetype: "bespoke", params: null },
  632: { erAbilityId: 632, archetype: "bespoke", params: null },
  633: { erAbilityId: 633, archetype: "bespoke", params: null },
  634: { erAbilityId: 634, archetype: "bespoke", params: null },
  635: { erAbilityId: 635, archetype: "composite-vanilla-mashup", params: {"parts":["Molten Down","Corrosion"]} },
  636: { erAbilityId: 636, archetype: "bespoke", params: null },
  637: { erAbilityId: 637, archetype: "bespoke", params: null },
  638: { erAbilityId: 638, archetype: "composite-vanilla-mashup", params: {"parts":["Blood Bath","Soul Eater"]} },
  639: { erAbilityId: 639, archetype: "bespoke", params: null },
  640: { erAbilityId: 640, archetype: "bespoke", params: null },
  641: { erAbilityId: 641, archetype: "bespoke", params: null },
  642: { erAbilityId: 642, archetype: "bespoke", params: null }, // Jackhammer: Hammer moves hit twice at 70% (was all-moves, full power) — see dispatchBespoke
  643: { erAbilityId: 643, archetype: "bespoke", params: null },
  644: { erAbilityId: 644, archetype: "bespoke", params: null }, // Ice Cold Hunter: Ice moves hit twice IN HAIL (full power) + hail immunity (composite — see dispatchBespoke)
  645: { erAbilityId: 645, archetype: "bespoke", params: null },
  646: { erAbilityId: 646, archetype: "bespoke", params: null }, // Arc Flash: 50% burn when hit AND 50% paralyze when attacking on contact (composite — see dispatchBespoke)
  647: { erAbilityId: 647, archetype: "bespoke", params: null }, // Unicorn: Mighty Horn (horn+drill ×1.3) + full Pixilate (Normal->Fairy, Fairy STAB, Fairy-user 10% infatuate) — see dispatchBespoke (the composite Pixilate part was a wrong flat boost)
  648: { erAbilityId: 648, archetype: "bespoke", params: null },
  649: { erAbilityId: 649, archetype: "bespoke", params: null },
  650: { erAbilityId: 650, archetype: "bespoke", params: null }, // Venoblaze Pincers — 1.2x physical + 20% burn-or-poison on contact; see dispatchBespoke
  651: { erAbilityId: 651, archetype: "composite-vanilla-mashup", params: {"parts":["Celestial Blessing","Regenerator"]} },
  652: { erAbilityId: 652, archetype: "composite-vanilla-mashup", params: {"parts":["Unburden","Ripen"]} },
  653: { erAbilityId: 653, archetype: "bespoke", params: null },
  654: { erAbilityId: 654, archetype: "composite-vanilla-mashup", params: {"parts":["Static","Rest in Peace"]} },
  655: { erAbilityId: 655, archetype: "bespoke", params: null },
  656: { erAbilityId: 656, archetype: "bespoke", params: null },
  657: { erAbilityId: 657, archetype: "type-conversion", params: {"sourceType":"NORMAL","targetType":"STEEL","multiplier":1.2,"flag":"SOUND_BASED"} },
  658: { erAbilityId: 658, archetype: "bespoke", params: null },
  659: { erAbilityId: 659, archetype: "type-conversion", params: {"sourceType":"STEEL","targetType":"ELECTRIC","multiplier":1.1} },
  660: { erAbilityId: 660, archetype: "bespoke", params: null },
  661: { erAbilityId: 661, archetype: "composite-vanilla-mashup", params: {"parts":["Inner Focus","Berserk"]} },
  662: { erAbilityId: 662, archetype: "bespoke", params: null },
  663: { erAbilityId: 663, archetype: "bespoke", params: null },
  664: { erAbilityId: 664, archetype: "composite-vanilla-mashup", params: {"parts":["Water Bubble","Flaming Soul"]} },
  665: { erAbilityId: 665, archetype: "composite-vanilla-mashup", params: {"parts":["Flash Fire","Water Absorb"]} },
  // 666 Snowy Wrath reclassified composite -> bespoke: Snow Warning's HAIL doesn't
  // carry the +50% Ice Defense the 2.65 dex wants, so the dispatcher summons the
  // bespoke SNOWY_WRATH weather (damaging snow + Ice-Def boost) plus Cryomancy's
  // frostbite rider. Composite parts entry removed (see er-composite-parts.ts).
  666: { erAbilityId: 666, archetype: "bespoke", params: null }, // Snowy Wrath — see dispatchBespoke

  667: { erAbilityId: 667, archetype: "composite-vanilla-mashup", params: {"parts":["Protean","Shed Skin"]} },
  668: { erAbilityId: 668, archetype: "bespoke", params: null },
  669: { erAbilityId: 669, archetype: "bespoke", params: null },
  670: { erAbilityId: 670, archetype: "bespoke", params: null },
  671: { erAbilityId: 671, archetype: "bespoke", params: null },
  672: { erAbilityId: 672, archetype: "bespoke", params: null },
  673: { erAbilityId: 673, archetype: "bespoke", params: null },
  674: { erAbilityId: 674, archetype: "bespoke", params: null },
  675: { erAbilityId: 675, archetype: "composite-vanilla-mashup", params: {"parts":["Speed Boost","Slipstream"]} },
  676: { erAbilityId: 676, archetype: "bespoke", params: null },
  677: { erAbilityId: 677, archetype: "bespoke", params: null },
  678: { erAbilityId: 678, archetype: "bespoke", params: null }, // Fluffiest: 1/4 contact dmg AND takes 4x from Fire (composite — see dispatchBespoke)
  679: { erAbilityId: 679, archetype: "composite-vanilla-mashup", params: {"parts":["Inner Focus","Precise Fist"]} },
  680: { erAbilityId: 680, archetype: "composite-vanilla-mashup", params: {"parts":["Pretentious","Swift Swim"]} },
  681: { erAbilityId: 681, archetype: "composite-vanilla-mashup", params: {"parts":["Iron Fist","30% Steel type damage"]} },
  682: { erAbilityId: 682, archetype: "composite-vanilla-mashup", params: {"parts":["Heatproof","Juggernaut"]} },
  683: { erAbilityId: 683, archetype: "composite-vanilla-mashup", params: {"parts":["Mega Launcher","Rampage"]} },
  684: { erAbilityId: 684, archetype: "composite-vanilla-mashup", params: {"parts":["Unseen Fist","Fatal Precision"]} },
  686: { erAbilityId: 686, archetype: "composite-vanilla-mashup", params: {"parts":["Hospitality","Soothing Aroma"]} },
  687: { erAbilityId: 687, archetype: "bespoke", params: null },
  688: { erAbilityId: 688, archetype: "composite-vanilla-mashup", params: {"parts":["Giant Wings","Levitate"]} },
  689: { erAbilityId: 689, archetype: "composite-vanilla-mashup", params: {"parts":["Unaware","Sword of Ruin"]} },
  690: { erAbilityId: 690, archetype: "bespoke", params: null },
  691: { erAbilityId: 691, archetype: "bespoke", params: null },
  692: { erAbilityId: 692, archetype: "bespoke", params: null },
  693: { erAbilityId: 693, archetype: "composite-vanilla-mashup", params: {"parts":["Disguise"]} },
  694: { erAbilityId: 694, archetype: "bespoke", params: null }, // Blind Rage: Scrappy + Mold Breaker, but must NOT bypass base-stat abilities (Grass Pelt) — see dispatchBespoke
  695: { erAbilityId: 695, archetype: "bespoke", params: null },
  696: { erAbilityId: 696, archetype: "composite-vanilla-mashup", params: {"parts":["Tough Claws","Predator"]} },
  697: { erAbilityId: 697, archetype: "bespoke", params: null },
  698: { erAbilityId: 698, archetype: "bespoke", params: null },
  699: { erAbilityId: 699, archetype: "bespoke", params: null },
  700: { erAbilityId: 700, archetype: "bespoke", params: null },
  701: { erAbilityId: 701, archetype: "composite-vanilla-mashup", params: {"parts":["Raging Boxer","Pollinate"]} },
  702: { erAbilityId: 702, archetype: "bespoke", params: null },
  703: { erAbilityId: 703, archetype: "bespoke", params: null },
  704: { erAbilityId: 704, archetype: "bespoke", params: null },
  705: { erAbilityId: 705, archetype: "bespoke", params: null },
  706: { erAbilityId: 706, archetype: "composite-vanilla-mashup", params: {"parts":["Strong Jaw","Bite moves have 50% paralysis chance"]} },
  707: { erAbilityId: 707, archetype: "composite-vanilla-mashup", params: {"parts":["Frisk","Scare"]} },
  708: { erAbilityId: 708, archetype: "bespoke", params: null },
  709: { erAbilityId: 709, archetype: "bespoke", params: null },
  710: { erAbilityId: 710, archetype: "bespoke", params: null },
  711: { erAbilityId: 711, archetype: "bespoke", params: null },
  712: { erAbilityId: 712, archetype: "damage-reduction-generic", params: {"filter":{"kind":"super-effective"},"reduction":0.35} },
  713: { erAbilityId: 713, archetype: "bespoke", params: null },
  714: { erAbilityId: 714, archetype: "composite-vanilla-mashup", params: {"parts":["Self Sufficient","Ripen"]} },
  715: { erAbilityId: 715, archetype: "bespoke", params: null },
  716: { erAbilityId: 716, archetype: "composite-vanilla-mashup", params: {"parts":["Merciless","Overcharge"]} },
  717: { erAbilityId: 717, archetype: "bespoke", params: null },
  718: { erAbilityId: 718, archetype: "bespoke", params: null },
  719: { erAbilityId: 719, archetype: "bespoke", params: null },
  720: { erAbilityId: 720, archetype: "bespoke", params: null }, // Stun Shock: 60% to paralyze OR poison (random) — bespoke for the two-effect roll
  721: { erAbilityId: 721, archetype: "composite-vanilla-mashup", params: {"parts":["Rampage","Hyper Aggressive"]} },
  722: { erAbilityId: 722, archetype: "bespoke", params: null },
  724: { erAbilityId: 724, archetype: "bespoke", params: null },
  725: { erAbilityId: 725, archetype: "composite-vanilla-mashup", params: {"parts":["Corrosion","Toxic Spill"]} },
  726: { erAbilityId: 726, archetype: "composite-vanilla-mashup", params: {"parts":["Intoxicate","Punk Rock"]} },
  727: { erAbilityId: 727, archetype: "composite-vanilla-mashup", params: {"parts":["On the Prowl","Stakeout"]} },
  728: { erAbilityId: 728, archetype: "bespoke", params: null },
  729: { erAbilityId: 729, archetype: "bespoke", params: null },
  730: { erAbilityId: 730, archetype: "bespoke", params: null },
  731: { erAbilityId: 731, archetype: "bespoke", params: null },
  732: { erAbilityId: 732, archetype: "bespoke", params: null },
  733: { erAbilityId: 733, archetype: "bespoke", params: null },
  734: { erAbilityId: 734, archetype: "bespoke", params: null },
  735: { erAbilityId: 735, archetype: "bespoke", params: null },
  736: { erAbilityId: 736, archetype: "bespoke", params: null },
  737: { erAbilityId: 737, archetype: "bespoke", params: null },
  738: { erAbilityId: 738, archetype: "bespoke", params: null },
  740: { erAbilityId: 740, archetype: "bespoke", params: null },
  741: { erAbilityId: 741, archetype: "composite-vanilla-mashup", params: {"parts":["Swift Swim","Stall"]} },
  742: { erAbilityId: 742, archetype: "bespoke", params: null },
  // 743 Cutthroat: "On entry, gives +1 priority to the FIRST Keen Edge (slicing) move
  // used. Consumed after landing any Keen Edge move. Resets if Sharpen is used." The
  // slicing-move twin of Edgelord (882) plus a Sharpen re-arm; moved to bespoke (see
  // dispatchBespoke case 743). The old priority-modifier approximation gave EVERY
  // slicing move +1 on the switch-in turn, never consumed, ignored Sharpen.
  //
  // (Superseded classifier note, kept for history:)
  // 743 Cutthroat: "first slicing move on each entry gets +1 priority". The classifier
  // dropped the SLICING filter, leaving a BARE priority that gave EVERY move +1 (the
  // "random outspeed" bug). Restored the SLICING_MOVE filter + the first-turn (entry-
  // turn, waveTurnCount===1) gate - ER's standard approximation of "first move per
  // entry" (same as Coil Up 302 / Sidewinder 676). Minor divergence: a slicing move
  // used on a LATER turn won't qualify (the literal "first per entry" isn't tracked).
  743: { erAbilityId: 743, archetype: "bespoke", params: null }, // Cutthroat — first Keen Edge move per entry gets +1 priority, consumed on landing a slicing move, re-armed by Sharpen (see dispatchBespoke case 743)
  744: { erAbilityId: 744, archetype: "composite-vanilla-mashup", params: {"parts":["Sand Stream","Sand Force"]} },
  745: { erAbilityId: 745, archetype: "bespoke", params: null },
  746: { erAbilityId: 746, archetype: "composite-vanilla-mashup", params: {"parts":["Desolate Land","Earth Eater"]} },
  747: { erAbilityId: 747, archetype: "chance-status-on-hit", params: {"chance":100,"status":"BURN","onContactOnly":true,"direction":"both"} }, // Daybreak: burns foe on contact (defense) + offense (desc)
  748: { erAbilityId: 748, archetype: "lifesteal", params: {"trigger":"on-hit-deal","healFraction":0.25} },
  749: { erAbilityId: 749, archetype: "composite-vanilla-mashup", params: {"parts":["Water Absorb","Storm Drain"]} },
  750: { erAbilityId: 750, archetype: "bespoke", params: null },
  751: { erAbilityId: 751, archetype: "bespoke", params: null },
  752: { erAbilityId: 752, archetype: "entry-effect", params: {"effect":{"kind":"set-hazard","hazard":"STICKY_WEB","layers":1}} },
  753: { erAbilityId: 753, archetype: "bespoke", params: null },
  754: { erAbilityId: 754, archetype: "bespoke", params: null },
  755: { erAbilityId: 755, archetype: "composite-vanilla-mashup", params: {"parts":["Inflatable","Hyper Aggressive"]} },
  756: { erAbilityId: 756, archetype: "bespoke", params: null },
  757: { erAbilityId: 757, archetype: "type-damage-boost", params: {"type":"DARK","multiplier":1.35,"recoilPct":0.1} },
  758: { erAbilityId: 758, archetype: "composite-vanilla-mashup", params: {"parts":["Rock Head","Reckless"]} },
  759: { erAbilityId: 759, archetype: "composite-vanilla-mashup", params: {"parts":["Shell Armor","50BP Thunder Cage when hit by contact"]} },
  760: { erAbilityId: 760, archetype: "composite-vanilla-mashup", params: {"parts":["Corrosion","Poison STAB"]} },
  // 761 Rose Garden — lays TWO layers of Toxic Spikes on the FOE's side (dex).
  // Without side:"foe" the hazard defaulted to "both" and badly-poisoned the
  // holder's own grounded switch-ins.
  761: { erAbilityId: 761, archetype: "entry-effect", params: {"effect":{"kind":"set-hazard","hazard":"TOXIC_SPIKES","layers":2,"side":"foe"}} },
  762: { erAbilityId: 762, archetype: "composite-vanilla-mashup", params: {"parts":["Always hits","Rampage"]} },
  763: { erAbilityId: 763, archetype: "composite-vanilla-mashup", params: {"parts":["Magic Guard","Magic Bounce"]} },
  764: { erAbilityId: 764, archetype: "bespoke", params: null },
  765: { erAbilityId: 765, archetype: "composite-vanilla-mashup", params: {"parts":["Soul Eater","Phantom Pain"]} },
  766: { erAbilityId: 766, archetype: "composite-vanilla-mashup", params: {"parts":["Intimidate","Violent Rush"]} },
  // 767 Presto: "Sound moves get +1 priority AT FULL HP" - the full-HP gate was missing.
  767: { erAbilityId: 767, archetype: "priority-modifier", params: {"priority":1,"filter":{"flag":"SOUND_BASED"},"condition":{"kind":"max-hp"}} },
  768: { erAbilityId: 768, archetype: "composite-vanilla-mashup", params: {"parts":["Striker","Dancer"]} },
  769: { erAbilityId: 769, archetype: "bespoke", params: null },
  770: { erAbilityId: 770, archetype: "type-damage-boost", params: {"type":"FIGHTING","multiplier":1.3,"lowHpMultiplier":1.8,"lowHpThreshold":0.3333333333333333} },
  771: { erAbilityId: 771, archetype: "bespoke", params: null },
  772: { erAbilityId: 772, archetype: "composite-vanilla-mashup", params: {"parts":["Exploit Weakness","Merciless"]} },
  773: { erAbilityId: 773, archetype: "bespoke", params: null },
  774: { erAbilityId: 774, archetype: "bespoke", params: null },
  775: { erAbilityId: 775, archetype: "bespoke", params: null },
  776: { erAbilityId: 776, archetype: "composite-vanilla-mashup", params: {"parts":["Mystic Power"]} },
  777: { erAbilityId: 777, archetype: "composite-vanilla-mashup", params: {"parts":["Mega Launcher","Artillery"]} },
  778: { erAbilityId: 778, archetype: "composite-vanilla-mashup", params: {"parts":["Poison Point","Mighty Horn"]} },
  779: { erAbilityId: 779, archetype: "composite-vanilla-mashup", params: {"parts":["Multiscale","Poison Point"]} },
  780: { erAbilityId: 780, archetype: "composite-vanilla-mashup", params: {"parts":["Mega Launcher","Status moves are Mega Launcher moves"]} },
  781: { erAbilityId: 781, archetype: "composite-vanilla-mashup", params: {"parts":["Ambush","Deadeye"]} },
  782: { erAbilityId: 782, archetype: "bespoke", params: null },
  783: { erAbilityId: 783, archetype: "composite-vanilla-mashup", params: {"parts":["Healer","Friend Guard"]} },
  784: { erAbilityId: 784, archetype: "bespoke", params: null },
  785: { erAbilityId: 785, archetype: "composite-vanilla-mashup", params: {"parts":["Hunger Switch","Elec and Dark deal 1.35x with 10% recoil"]} },
  786: { erAbilityId: 786, archetype: "bespoke", params: null },
  787: { erAbilityId: 787, archetype: "bespoke", params: null },
  788: { erAbilityId: 788, archetype: "bespoke", params: null },
  789: { erAbilityId: 789, archetype: "composite-vanilla-mashup", params: {"parts":["Impenetrable","Sturdy"]} },
  790: { erAbilityId: 790, archetype: "composite-vanilla-mashup", params: {"parts":["Hyper Aggressive","Shadow Tag"]} },
  791: { erAbilityId: 791, archetype: "bespoke", params: null },
  792: { erAbilityId: 792, archetype: "composite-vanilla-mashup", params: {"parts":["Metallic","Primal Maw"]} },
  793: { erAbilityId: 793, archetype: "composite-vanilla-mashup", params: {"parts":["Analytic","Neuroforce"]} },
  794: { erAbilityId: 794, archetype: "bespoke", params: null },
  795: { erAbilityId: 795, archetype: "entry-effect", params: {"effect":{"kind":"self-stat-boost","stat":"SPD","stages":1}} },
  796: { erAbilityId: 796, archetype: "entry-effect", params: {"effect":{"kind":"self-stat-boost","stat":"ATK","stages":1}} },
  797: { erAbilityId: 797, archetype: "entry-effect", params: {"effect":{"kind":"self-stat-boost","stat":"DEF","stages":1}} },
  798: { erAbilityId: 798, archetype: "entry-effect", params: {"effect":{"kind":"self-stat-boost","stat":"SPDEF","stages":1}} },
  799: { erAbilityId: 799, archetype: "type-damage-boost", params: {"type":"ROCK","multiplier":1.3,"lowHpMultiplier":1.8,"lowHpThreshold":0.3333333333333333} },
  800: { erAbilityId: 800, archetype: "bespoke", params: null },
  801: { erAbilityId: 801, archetype: "composite-vanilla-mashup", params: {"parts":["Leaf Guard","Harvest"]} },
  802: { erAbilityId: 802, archetype: "bespoke", params: null }, // Rite Of Spring: sun -> SPD x1.5 + highest attacking stat x1.5 (the Chlorophyll+Solar Power composite gave SPD x2, SpAtk-only, and an unwanted HP drain) — see dispatchBespoke
  803: { erAbilityId: 803, archetype: "entry-effect", params: {"effect":{"kind":"self-stat-boost","stat":"SPDEF","stages":1}} },
  804: { erAbilityId: 804, archetype: "bespoke", params: null },
  805: { erAbilityId: 805, archetype: "composite-vanilla-mashup", params: {"parts":["Tinted Lens","Sand Guard"]} },
  806: { erAbilityId: 806, archetype: "composite-vanilla-mashup", params: {"parts":["Sniper"]} },
  807: { erAbilityId: 807, archetype: "bespoke", params: null },
  808: { erAbilityId: 808, archetype: "bespoke", params: null },
  809: { erAbilityId: 809, archetype: "bespoke", params: null },
  810: { erAbilityId: 810, archetype: "bespoke", params: null },
  811: { erAbilityId: 811, archetype: "composite-vanilla-mashup", params: {"parts":["Tinted Lens","Rampage"]} },
  812: { erAbilityId: 812, archetype: "bespoke", params: null },
  813: { erAbilityId: 813, archetype: "bespoke", params: null },
  814: { erAbilityId: 814, archetype: "bespoke", params: null },
  815: { erAbilityId: 815, archetype: "bespoke", params: null },
  816: { erAbilityId: 816, archetype: "bespoke", params: null },
  817: { erAbilityId: 817, archetype: "bespoke", params: null },
  818: { erAbilityId: 818, archetype: "bespoke", params: null }, // Tentalock: Grappler + Serpent Bind, but the trap PROC is 6 turns / 1/6 HP (not Serpent Bind's 4-5) — see dispatchBespokeR48
  819: { erAbilityId: 819, archetype: "bespoke", params: null },
  820: { erAbilityId: 820, archetype: "bespoke", params: null },
  821: { erAbilityId: 821, archetype: "composite-vanilla-mashup", params: {"parts":["Scare","Bad Luck"]} },
  822: { erAbilityId: 822, archetype: "composite-vanilla-mashup", params: {"parts":["Phantom","Shadow Shield"]} },
  823: { erAbilityId: 823, archetype: "bespoke", params: null },
  824: { erAbilityId: 824, archetype: "bespoke", params: null },
  825: { erAbilityId: 825, archetype: "composite-vanilla-mashup", params: {"parts":["Slush Rush","Snow Cloak"]} },
  826: { erAbilityId: 826, archetype: "composite-vanilla-mashup", params: {"parts":["Cute Charm","Fairy STAB"]} },
  827: { erAbilityId: 827, archetype: "composite-vanilla-mashup", params: {"parts":["Shed Skin","Wonder Skin"]} },
  828: { erAbilityId: 828, archetype: "bespoke", params: null },
  829: { erAbilityId: 829, archetype: "composite-vanilla-mashup", params: {"parts":["Fort Knox","Steelworker"]} },
  830: { erAbilityId: 830, archetype: "bespoke", params: null },
  831: { erAbilityId: 831, archetype: "bespoke", params: null },
  832: { erAbilityId: 832, archetype: "bespoke", params: null },
  833: { erAbilityId: 833, archetype: "bespoke", params: null },
  834: { erAbilityId: 834, archetype: "bespoke", params: null },
  835: { erAbilityId: 835, archetype: "composite-vanilla-mashup", params: {"parts":["Aquatic Dweller","Swift Swim"]} },
  836: { erAbilityId: 836, archetype: "bespoke", params: null },
  837: { erAbilityId: 837, archetype: "bespoke", params: null },
  838: { erAbilityId: 838, archetype: "bespoke", params: null },
  839: { erAbilityId: 839, archetype: "bespoke", params: null },
  840: { erAbilityId: 840, archetype: "composite-vanilla-mashup", params: {"parts":["Rough Skin","Poison Point"]} },
  841: { erAbilityId: 841, archetype: "composite-vanilla-mashup", params: {"parts":["Draconize","Half Drake"]} },
  842: { erAbilityId: 842, archetype: "bespoke", params: null },
  843: { erAbilityId: 843, archetype: "bespoke", params: null },
  844: { erAbilityId: 844, archetype: "composite-vanilla-mashup", params: {"parts":["Mystic blades","use 20% of spdef during moves"]} },
  845: { erAbilityId: 845, archetype: "composite-vanilla-mashup", params: {"parts":["Mighty Horn","30% Bleed chance on horn moves"]} },
  846: { erAbilityId: 846, archetype: "composite-vanilla-mashup", params: {"parts":["Dual Wield","Best Offense"]} },
  847: { erAbilityId: 847, archetype: "entry-effect", params: {"effect":{"kind":"add-self-type","type":"ELECTRIC"}} },
  848: { erAbilityId: 848, archetype: "composite-vanilla-mashup", params: {"parts":["Steadfast","blocks phasing moves"]} },
  849: { erAbilityId: 849, archetype: "bespoke", params: null }, // World Serpent: physical non-contact +20% + 50% contact-trap (bespoke — see dispatchBespoke; Long Reach/Grip Pincer composite was wrong)
  850: { erAbilityId: 850, archetype: "composite-vanilla-mashup", params: {"parts":["Serene Grace","Giant Wings"]} },
  851: { erAbilityId: 851, archetype: "bespoke", params: null },
  852: { erAbilityId: 852, archetype: "chance-status-on-hit", params: {"chance":30,"status":"POISON","direction":"offense","onContactOnly":false} }, // Envenom: holder's move poisons the target after landing ANY move (not contact-only)
  853: { erAbilityId: 853, archetype: "bespoke", params: null },
  854: { erAbilityId: 854, archetype: "composite-vanilla-mashup", params: {"parts":["Mega Launcher","Mind Crunch"]} },
  855: { erAbilityId: 855, archetype: "bespoke", params: null },
  856: { erAbilityId: 856, archetype: "composite-vanilla-mashup", params: {"parts":["Mineralize","Rock moves have 50% burn chance"]} },
  857: { erAbilityId: 857, archetype: "composite-vanilla-mashup", params: {"parts":["Queenly Majesty","Glare on entry once per battle"]} },
  858: { erAbilityId: 858, archetype: "stat-trigger-on-event", params: {"trigger":"on-ko","stats":[{"stat":"SPD","stages":1}]} },
  859: { erAbilityId: 859, archetype: "composite-vanilla-mashup", params: {"parts":["Comatose","Dreamcatcher","Deal 20% more damage"]} },
  860: { erAbilityId: 860, archetype: "composite-vanilla-mashup", params: {"parts":["Stall","Analytic"]} },
  861: { erAbilityId: 861, archetype: "composite-vanilla-mashup", params: {"parts":["Strong Jaw","Jaws of Carnage"]} },
  862: { erAbilityId: 862, archetype: "bespoke", params: null },
  863: { erAbilityId: 863, archetype: "composite-vanilla-mashup", params: {"parts":["Pyromancy","Cryomancy"]} },
  864: { erAbilityId: 864, archetype: "bespoke", params: null },
  865: { erAbilityId: 865, archetype: "type-resist-or-absorb", params: {"type":"FIRE","effect":{"kind":"absorb","redirect":true,"statBoost":{"highestAttack":true,"stages":1}}} }, // Heat Sink: Fire absorb boosts HIGHEST attacking stat (ATK vs SpAtk), not fixed ATK
  866: { erAbilityId: 866, archetype: "bespoke", params: null },
  867: { erAbilityId: 867, archetype: "composite-vanilla-mashup", params: {"parts":["Drizzle","Electro Surge"]} },
  868: { erAbilityId: 868, archetype: "bespoke", params: null },
  // --- 869-873 cluster (Legendary weather/aspect quintet) ---------------------
  // These five were CROSS-WIRED: each row implemented a NEIGHBOUR's dex effect.
  // Re-keyed so every ability implements ITS OWN ER 2.65 dex entry. Do not
  // shuffle without re-reading the dex — the effects deliberately do not overlap.
  // 869 Blistering Sun — Fire immunity + heal 25% on Fire hit + always burn on
  //   attack. Hand-wired: dispatchBespokeR48 case 869.
  869: { erAbilityId: 869, archetype: "bespoke", params: null },
  // 870 Molten Core — SpAtk x1.5 + Aurora Veil on entry + Hail immunity =
  //   er323 Majestic Bird + er348 North Wind.
  870: { erAbilityId: 870, archetype: "composite-vanilla-mashup", params: {"parts":["Majestic Bird","North Wind"]} },
  // 871 Fire Aspect — primal Desolate Land + 3-turn Tailwind on entry + doubles
  //   all allies' Speed = Desolate Land (190) + er320 Air Blower (+ double-speed rider).
  871: { erAbilityId: 871, archetype: "composite-vanilla-mashup", params: {"parts":["Desolate Land","Air Blower"]} },
  // 872 Aurora's Gale — halves all incoming Special-attack damage (x0.5).
  872: { erAbilityId: 872, archetype: "damage-reduction-generic", params: {"filter":{"kind":"special"},"reduction":0.5} },
  // 873 Ice Plumes — +2 Speed on Rock hit / SR-present switch-in + absorb Rock &
  //   Stealth Rock (heal 25%) = er447 Furnace + Rock/SR-absorb rider.
  873: { erAbilityId: 873, archetype: "composite-vanilla-mashup", params: {"parts":["Furnace","Absorbs Rock-moves/Stealth Rocks"]} },
  874: { erAbilityId: 874, archetype: "bespoke", params: null },
  875: { erAbilityId: 875, archetype: "lifesteal", params: {"trigger":"on-hit-deal","healFraction":0.125} },
  876: { erAbilityId: 876, archetype: "bespoke", params: null },
  877: { erAbilityId: 877, archetype: "bespoke", params: null },
  878: { erAbilityId: 878, archetype: "bespoke", params: null },
  879: { erAbilityId: 879, archetype: "bespoke", params: null },
  880: { erAbilityId: 880, archetype: "bespoke", params: null },
  881: { erAbilityId: 881, archetype: "composite-vanilla-mashup", params: {"parts":["Fossilized","Rock moves ignore abilities"]} },
  // 882 Edgelord: "first Keen Edge move each entry gets +1 priority. Resets on KO".
  // Keen Edge = SLICING_MOVE. Classifier dropped the filter -> bare priority gave EVERY
  // move +1 (random-outspeed bug). Restored the SLICING_MOVE filter + first-turn (entry-
  // turn) gate, ER's approximation of "first move per entry". Minor divergence: the
  // literal "first per entry / resets on KO" isn't tracked (uses the entry turn instead).
  882: { erAbilityId: 882, archetype: "bespoke", params: null }, // Edgelord — first Keen Edge move each entry gets +1 priority, resets on KO (see dispatchBespoke case 882, mirrors Sidewinder 676)
  883: { erAbilityId: 883, archetype: "bespoke", params: null },
  884: { erAbilityId: 884, archetype: "bespoke", params: null },
  885: { erAbilityId: 885, archetype: "bespoke", params: null },
  886: { erAbilityId: 886, archetype: "bespoke", params: null },
  887: { erAbilityId: 887, archetype: "bespoke", params: null },
  888: { erAbilityId: 888, archetype: "bespoke", params: null },
  889: { erAbilityId: 889, archetype: "bespoke", params: null },
  890: { erAbilityId: 890, archetype: "bespoke", params: null },
  891: { erAbilityId: 891, archetype: "bespoke", params: null },
  892: { erAbilityId: 892, archetype: "bespoke", params: null },
  893: { erAbilityId: 893, archetype: "bespoke", params: null },
  894: { erAbilityId: 894, archetype: "composite-vanilla-mashup", params: {"parts":["Hospitality","Friend Guard"]} },
  895: { erAbilityId: 895, archetype: "bespoke", params: null },
  896: { erAbilityId: 896, archetype: "bespoke", params: null },
  897: { erAbilityId: 897, archetype: "chance-status-on-hit", params: {"chance":30,"status":"POISON","filter":{"type":"ELECTRIC"},"direction":"offense"} }, // Virus: holder's ELECTRIC move poisons (desc)
  898: { erAbilityId: 898, archetype: "bespoke", params: null },
  899: { erAbilityId: 899, archetype: "bespoke", params: null },
  900: { erAbilityId: 900, archetype: "composite-vanilla-mashup", params: {"parts":["Sand Force","Sand Guard"]} },
  901: { erAbilityId: 901, archetype: "composite-vanilla-mashup", params: {"parts":["Tangling Hair","Stamina"]} },
  902: { erAbilityId: 902, archetype: "composite-vanilla-mashup", params: {"parts":["Field Explorer","Illuminate"]} },
  903: { erAbilityId: 903, archetype: "composite-vanilla-mashup", params: {"parts":["Desert Cloak","Self Sufficient"]} },
  904: { erAbilityId: 904, archetype: "bespoke", params: null },
  905: { erAbilityId: 905, archetype: "bespoke", params: null },
  906: { erAbilityId: 906, archetype: "bespoke", params: null },
  910: { erAbilityId: 910, archetype: "bespoke", params: null },
  911: { erAbilityId: 911, archetype: "bespoke", params: null },
  908: { erAbilityId: 908, archetype: "bespoke", params: null }, // Lightsaber: "Adds Fire-type. Keen Edge moves 25% burn" — pure hand-wired (no vanilla parts); both halves wired in dispatchBespokeR48
  909: { erAbilityId: 909, archetype: "bespoke", params: null },
  912: { erAbilityId: 912, archetype: "bespoke", params: null },
  907: { erAbilityId: 907, archetype: "chance-status-on-hit", params: {"chance":50,"status":"BURN","filter":{"flag":"MIGHTY_HORN"},"direction":"offense"} }, // Laser Drill: holder's HORN move burns (desc)
  913: { erAbilityId: 913, archetype: "bespoke", params: null },
  914: { erAbilityId: 914, archetype: "bespoke", params: null },
  915: { erAbilityId: 915, archetype: "entry-effect", params: {"effect":{"kind":"add-self-type","type":"FIGHTING"}} },
  916: { erAbilityId: 916, archetype: "bespoke", params: null },
  917: { erAbilityId: 917, archetype: "bespoke", params: null },
  918: { erAbilityId: 918, archetype: "composite-vanilla-mashup", params: {"parts":["Half Drake","Rough Skin"]} },
  920: { erAbilityId: 920, archetype: "entry-effect", params: {"effect":{"kind":"add-self-type","type":"ROCK"}} },
  919: { erAbilityId: 919, archetype: "composite-vanilla-mashup", params: {"parts":["Tough Claws","Mineralize"]} },
  921: { erAbilityId: 921, archetype: "bespoke", params: null },
  945: { erAbilityId: 945, archetype: "bespoke", params: null },
  // 923 Galeforce Wings: "Flying moves get +1 Priority" (Gale Wings). Classifier dropped
  // the FLYING type filter -> bare priority gave EVERY move +1 (random-outspeed bug).
  // Restored the type filter; now faithful to the dex.
  946: { erAbilityId: 946, archetype: "priority-modifier", params: {"priority":1,"filter":{"type":"FLYING"}} },
  922: { erAbilityId: 922, archetype: "composite-vanilla-mashup", params: {"parts":["Queenly Majesty","Rivalry"]} },
  923: { erAbilityId: 923, archetype: "bespoke", params: null },
  925: { erAbilityId: 925, archetype: "composite-vanilla-mashup", params: {"parts":["Fire Scales","Taste the Rainbow"]} },
  924: { erAbilityId: 924, archetype: "bespoke", params: null },
  926: { erAbilityId: 926, archetype: "chance-status-on-hit", params: {"chance":20,"status":"SLEEP","onContactOnly":true,"direction":"both"} }, // Hypnotic Touch: sleep on contact (defense) + offense (desc)
  928: { erAbilityId: 928, archetype: "composite-vanilla-mashup", params: {"parts":["Multi-Headed","Hubris"]} },
  927: { erAbilityId: 927, archetype: "bespoke", params: null },
  929: { erAbilityId: 929, archetype: "composite-vanilla-mashup", params: {"parts":["Snow Warning","Ice Body"]} },
  930: { erAbilityId: 930, archetype: "composite-vanilla-mashup", params: {"parts":["Tough Claws","Slush Rush"]} },
  931: { erAbilityId: 931, archetype: "bespoke", params: null },
  934: { erAbilityId: 934, archetype: "composite-vanilla-mashup", params: {"parts":["Deadly Precision","Slipstream"]} },
  935: { erAbilityId: 935, archetype: "bespoke", params: null },
  936: { erAbilityId: 936, archetype: "composite-vanilla-mashup", params: {"parts":["Juggernaut","Thick Fat"]} },
  937: { erAbilityId: 937, archetype: "bespoke", params: null },
  938: { erAbilityId: 938, archetype: "bespoke", params: null },
  939: { erAbilityId: 939, archetype: "composite-vanilla-mashup", params: {"parts":["Magic Guard","Cosmic Daze"]} },
  940: { erAbilityId: 940, archetype: "bespoke", params: null },
  941: { erAbilityId: 941, archetype: "bespoke", params: null },
  942: { erAbilityId: 942, archetype: "bespoke", params: null },
  943: { erAbilityId: 943, archetype: "bespoke", params: null },
  944: { erAbilityId: 944, archetype: "bespoke", params: null },
  947: { erAbilityId: 947, archetype: "bespoke", params: null },
  948: { erAbilityId: 948, archetype: "composite-vanilla-mashup", params: {"parts":["Tangling Hair","Fluffy"]} },
  949: { erAbilityId: 949, archetype: "bespoke", params: null },
  950: { erAbilityId: 950, archetype: "composite-vanilla-mashup", params: {"parts":["Know Your Place","Grappler"]} },
  951: { erAbilityId: 951, archetype: "bespoke", params: null },
  952: { erAbilityId: 952, archetype: "bespoke", params: null },
  953: { erAbilityId: 953, archetype: "bespoke", params: null },
  954: { erAbilityId: 954, archetype: "composite-vanilla-mashup", params: {"parts":["Thick Fat","Corrosion"]} },
  955: { erAbilityId: 955, archetype: "bespoke", params: null },
  956: { erAbilityId: 956, archetype: "bespoke", params: null },
  957: { erAbilityId: 957, archetype: "bespoke", params: null },
  958: { erAbilityId: 958, archetype: "composite-vanilla-mashup", params: {"parts":["Impenetrable","Bulletproof"]} },
  959: { erAbilityId: 959, archetype: "composite-vanilla-mashup", params: {"parts":["Keen edge","Grass moves become Keen Edge boosted"]} },
  960: { erAbilityId: 960, archetype: "bespoke", params: null },
  987: { erAbilityId: 987, archetype: "bespoke", params: null },
  961: { erAbilityId: 961, archetype: "composite-vanilla-mashup", params: {"parts":["Hyper Aggressive","Hover"]} },
  962: { erAbilityId: 962, archetype: "composite-vanilla-mashup", params: {"parts":["Prism Scales","Huge Wings"]} },
  963: { erAbilityId: 963, archetype: "bespoke", params: null },
  965: { erAbilityId: 965, archetype: "composite-vanilla-mashup", params: {"parts":["King's Wrath","Flame Shield"]} },
  966: { erAbilityId: 966, archetype: "composite-vanilla-mashup", params: {"parts":["Illuminate","Pyromancy"]} },
  967: { erAbilityId: 967, archetype: "bespoke", params: null },
  968: { erAbilityId: 968, archetype: "composite-vanilla-mashup", params: {"parts":["Shell Armor","Poison Point"]} },
  969: { erAbilityId: 969, archetype: "composite-vanilla-mashup", params: {"parts":["Multi-Headed","Water STAB"]} },
  970: { erAbilityId: 970, archetype: "composite-vanilla-mashup", params: {"parts":["Metallic","Battle Armor"]} },
  971: { erAbilityId: 971, archetype: "composite-vanilla-mashup", params: {"parts":["Intimidate","Scare"],"rider":"10% burn chance on non contact moves"} },
  972: { erAbilityId: 972, archetype: "composite-vanilla-mashup", params: {"parts":["King's Wrath","Queen's Mourning"]} },
  973: { erAbilityId: 973, archetype: "composite-vanilla-mashup", params: {"parts":["Swarm","Unaware"]} },
  974: { erAbilityId: 974, archetype: "bespoke", params: null },
  975: { erAbilityId: 975, archetype: "bespoke", params: null },
  976: { erAbilityId: 976, archetype: "composite-vanilla-mashup", params: {"parts":["Striker"]} },
  977: { erAbilityId: 977, archetype: "bespoke", params: null },
  978: { erAbilityId: 978, archetype: "composite-vanilla-mashup", params: {"parts":["Strong Jaw"]} },
  979: { erAbilityId: 979, archetype: "bespoke", params: null },
  980: { erAbilityId: 980, archetype: "composite-vanilla-mashup", params: {"parts":["Aura Break","Mega Launcher"]} },
  981: { erAbilityId: 981, archetype: "bespoke", params: null },
  983: { erAbilityId: 983, archetype: "bespoke", params: null },
  982: { erAbilityId: 982, archetype: "composite-vanilla-mashup", params: {"parts":["Cryomancy","Frostbite causes flinching"]} },
  984: { erAbilityId: 984, archetype: "bespoke", params: null },
  985: { erAbilityId: 985, archetype: "composite-vanilla-mashup", params: {"parts":["Mighty Horn","all Drill moves are 30% stronger"]} },
  986: { erAbilityId: 986, archetype: "composite-vanilla-mashup", params: {"parts":["Takes 30% less damage from attacks","Gooey"]} },
  964: { erAbilityId: 964, archetype: "composite-vanilla-mashup", params: {"parts":["Dazzling","Defiant"]} },
  988: { erAbilityId: 988, archetype: "composite-vanilla-mashup", params: {"parts":["Let's Roll","Coil Up"]} },
  989: { erAbilityId: 989, archetype: "bespoke", params: null },
  990: { erAbilityId: 990, archetype: "composite-vanilla-mashup", params: {"parts":["Aquatic","Adaptability"]} },
  932: { erAbilityId: 932, archetype: "bespoke", params: null },
  933: { erAbilityId: 933, archetype: "bespoke", params: null },
  991: { erAbilityId: 991, archetype: "bespoke", params: null },
  992: { erAbilityId: 992, archetype: "composite-vanilla-mashup", params: {"parts":["Berserk","Rampage"]} },
  993: { erAbilityId: 993, archetype: "bespoke", params: null },
  994: { erAbilityId: 994, archetype: "bespoke", params: null },
  995: { erAbilityId: 995, archetype: "bespoke", params: null },
  996: { erAbilityId: 996, archetype: "bespoke", params: null },
  997: { erAbilityId: 997, archetype: "composite-vanilla-mashup", params: {"parts":["Battle Armor","Scrapyard"]} },
  998: { erAbilityId: 998, archetype: "bespoke", params: null },
  999: { erAbilityId: 999, archetype: "composite-vanilla-mashup", params: {"parts":["Hyper Aggressive","Soul Eater"]} },
  1000: { erAbilityId: 1000, archetype: "bespoke", params: null },
  1001: { erAbilityId: 1001, archetype: "composite-vanilla-mashup", params: {"parts":["Scavenger","Technician"]} },
  1002: { erAbilityId: 1002, archetype: "composite-vanilla-mashup", params: {"parts":["Filter","Shell Armor"]} },
  1003: { erAbilityId: 1003, archetype: "composite-vanilla-mashup", params: {"parts":["Big Pecks","Scrappy"]} },
  1004: { erAbilityId: 1004, archetype: "bespoke", params: null },
  1005: { erAbilityId: 1005, archetype: "bespoke", params: null },
  1006: { erAbilityId: 1006, archetype: "bespoke", params: null },
  1007: { erAbilityId: 1007, archetype: "composite-vanilla-mashup", params: {"parts":["Reckless","Thundercall"]} },
  1008: { erAbilityId: 1008, archetype: "bespoke", params: null },
  1009: { erAbilityId: 1009, archetype: "bespoke", params: null },
  1010: { erAbilityId: 1010, archetype: "composite-vanilla-mashup", params: {"parts":["Thermal Exchange","Heatproof"]} },
  1011: { erAbilityId: 1011, archetype: "composite-vanilla-mashup", params: {"parts":["Mystic Blades","Keen Edge moves lower SpDef"]} },
  1012: { erAbilityId: 1012, archetype: "bespoke", params: null },
  1013: { erAbilityId: 1013, archetype: "composite-vanilla-mashup", params: {"parts":["Terrify","Deviate"]} },
  1014: { erAbilityId: 1014, archetype: "chance-status-on-hit", params: {"chance":30,"status":"BURN","filter":{"type":"GRASS"},"direction":"offense"} }, // Ghost Pepper: holder's GRASS move burns (desc)
  1015: { erAbilityId: 1015, archetype: "composite-vanilla-mashup", params: {"parts":["Heatproof","Shell Armor"]} },
  1016: { erAbilityId: 1016, archetype: "composite-vanilla-mashup", params: {"parts":["Multi-Headed","Riptide"]} },
  1017: { erAbilityId: 1017, archetype: "composite-vanilla-mashup", params: {"parts":["Iron Fist"]} },
  1018: { erAbilityId: 1018, archetype: "bespoke", params: null },
  1019: { erAbilityId: 1019, archetype: "composite-vanilla-mashup", params: {"parts":["Amplifier","attacks with 30 BP Hyper Voice when hit"]} },
  1020: { erAbilityId: 1020, archetype: "composite-vanilla-mashup", params: {"parts":["Power Core","Aftermath"]} },
  1021: { erAbilityId: 1021, archetype: "damage-reduction-generic", params: {"filter":{"kind":"all"},"reduction":0.35} },
  // Deflect — "Counters with 20BP Vacuum Wave when hit. Takes 20% less damage."
  // Bespoke: the damage-reduction-generic archetype only emits the reduction;
  // the Vacuum Wave counter half needs a CounterAttackOnHit (see dispatcher).
  1022: { erAbilityId: 1022, archetype: "bespoke", params: null },
  1023: { erAbilityId: 1023, archetype: "type-damage-boost", params: {"type":"PSYCHIC","multiplier":1.3,"lowHpMultiplier":1.8,"lowHpThreshold":0.3333333333333333} },
  1024: { erAbilityId: 1024, archetype: "composite-vanilla-mashup", params: {"parts":["Infiltrator","Competitive"]} },
  1026: { erAbilityId: 1026, archetype: "composite-vanilla-mashup", params: {"parts":["Tough Claws","Foul Energy"]} },
  1025: { erAbilityId: 1025, archetype: "type-damage-boost", params: {"type":"DARK","multiplier":1.2,"lowHpMultiplier":1.5,"lowHpThreshold":0.3333333333333333} },
  1027: { erAbilityId: 1027, archetype: "bespoke", params: null },
  1028: { erAbilityId: 1028, archetype: "bespoke", params: null },
  1029: { erAbilityId: 1029, archetype: "composite-vanilla-mashup", params: {"parts":["Mighty Horn","Fighting Spirit"]} },
  1030: { erAbilityId: 1030, archetype: "bespoke", params: null },
  // Rock Armor — "Rocky Exterior + takes 10% less damage from attacks." Bespoke:
  // the damage-reduction-generic archetype only emits the 10% reduction; the
  // Rocky Exterior half (add Rock type on entry, er-919) needs an EntryEffect.
  1031: { erAbilityId: 1031, archetype: "bespoke", params: null },
  1032: { erAbilityId: 1032, archetype: "composite-vanilla-mashup", params: {"parts":["Raw Wood","Flame Body"]} },
  1033: { erAbilityId: 1033, archetype: "composite-vanilla-mashup", params: {"parts":["Sticky Hold","Gooey"]} },
  // 267 stripped — id-resync drift; entry no longer points to a real draft.
  // 796-798 (Embody Aspect Atk/Def/SpDef on entry). NOTE: the auto-generated
  // ER_ABILITIES collapsed all four Embody variants to id 795 (generator
  // id-drift), so 796-798 have no draft and aren't built by the main init loop.
  // initEliteReduxCustomAbilities constructs them explicitly from synthetic
  // drafts (registering 5497-5499) and wires the entry-effect via these rows.
};
