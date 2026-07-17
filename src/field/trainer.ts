import { globalScene } from "#app/global-scene";
import { pokemonPrevolutions } from "#balance/pokemon-evolutions";
import { signatureSpecies } from "#balance/signature-species";
import { EntryHazardTag } from "#data/arena-tag";
import { isErSmartSwitching } from "#data/elite-redux/er-enemy-ai";
import type { GhostApproachEffect } from "#data/elite-redux/er-ghost-profile";
import { applyErGhostOverride } from "#data/elite-redux/er-ghost-teams";
import {
  applyErFactoryOverride,
  applyErRivalOverride,
  applyErRosterOverride,
} from "#data/elite-redux/er-trainer-runtime-hook";
import { applyShowdownOverride } from "#data/elite-redux/showdown/showdown-enemy-build";
import type { PokemonSpecies } from "#data/pokemon-species";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { Challenges } from "#enums/challenges";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { SpeciesId } from "#enums/species-id";
import { TeraAIMode } from "#enums/tera-ai-mode";
import { TrainerPoolTier } from "#enums/trainer-pool-tier";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { EnemyPokemon } from "#field/pokemon";
import type { PersistentModifier } from "#modifiers/modifier";
import { ErTrainerAuraFx } from "#sprites/er-trainer-aura-fx";
import type { TrainerConfig } from "#trainers/trainer-config";
import { trainerConfigs } from "#trainers/trainer-config";
import { TrainerPartyCompoundTemplate, type TrainerPartyTemplate } from "#trainers/trainer-party-template";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getRandomLocaleEntry } from "#utils/i18n";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";

export class Trainer extends Phaser.GameObjects.Container {
  public config: TrainerConfig;
  public variant: TrainerVariant;
  public partyTemplateIndex: number;
  public partnerName: string;
  public nameKey: string;
  public partnerNameKey: string | undefined;
  public originalIndexes: { [key: number]: number } = {};
  /**
   * Per-instance override for `getEncounterMessages`. Used by the LLM
   * Director to replace the trainer's canonical "I challenge you!" line
   * with the story-themed `preBattleText` so the in-battle dialogue
   * fires through the standard EncounterPhase flow (sprite + name +
   * proper timing) instead of as a separate MessagePhase queued before.
   * `undefined` means "use canonical config dialogue" (vanilla behavior).
   */
  public encounterMessagesOverride?: string[] | undefined;

  /**
   * ER Ghost Trainer FX: the equipped ENTRANCE effect (the on-field arrival
   * tween, resolved in encounter-phase). `undefined` = the vanilla slide-in.
   * Set by `markTrainerAsGhost` from the uploader's published profile.
   */
  public erGhostApproach?: GhostApproachEffect | undefined;

  /**
   * ER Ghost Trainer FX: the equipped AURA effect (an AROUND shader id). Only set
   * when the uploader equipped an aura AND flagged `showAuraInBattle`. The overlay
   * is built lazily by {@linkcode applyErGhostAuraFx} once the trainer is revealed.
   */
  public erGhostAura?: string | undefined;

  /**
   * ER Ghost Trainer FX: playback speed + intensity multipliers (default 1x) applied
   * to BOTH the entrance tween and the aura overlay. Set by `markTrainerAsGhost` from
   * the uploader's published (and clamped) profile.
   */
  public erGhostFxSpeed?: number | undefined;
  public erGhostFxIntensity?: number | undefined;

  /**
   * ER (#419 follow-up): true when this trainer is a cross-player GHOST (its party is
   * an uploader's stored roster fielded VERBATIM). Set by `markTrainerAsGhost`. Read by
   * the universal BST power gate (`enforceErEliteBstCurve`) to exempt the whole ghost
   * battle - a ghost's fairness is the +40-wave eligibility window, NOT species mutation,
   * so the wave-ladder cap must not devolve/swap its mons. A plain field keeps the gate
   * import-free (avoids the ghost module's circular-init hazard).
   */
  public erIsGhost?: boolean | undefined;

  private erAuraFx: ErTrainerAuraFx | null = null;
  /** Per-instance counter used to namespace generated aura-FX texture keys. */
  private static erAuraFxSeq = 0;
  private readonly erAuraFxKey = `trainer-aura-fx-${Trainer.erAuraFxSeq++}`;

  /**
   * Create a new Trainer.
   * @param trainerType - The {@linkcode TrainerType} for this trainer, used to determine
   * name, sprite, party contents and other details.
   * @param variant - The {@linkcode TrainerVariant} for this trainer (if any are available)
   * @param partyTemplateIndex - If provided, will override the trainer's party template with the given
   * version.
   * @param nameKey - If provided, will override the name key of the trainer
   * @param partnerNameKey - If provided, will override the
   * @param trainerConfigOverride - If provided, will override the trainer config for the given trainer type
   * @todo Review how many of these parameters we actually need
   */
  constructor(
    trainerType: TrainerType,
    variant: TrainerVariant,
    partyTemplateIndex?: number,
    nameKey?: string,
    partnerNameKey?: string,
    trainerConfigOverride?: TrainerConfig,
  ) {
    super(globalScene, -72, 80);
    this.config =
      trainerConfigOverride
      ?? (Object.hasOwn(trainerConfigs, trainerType)
        ? trainerConfigs[trainerType]
        : trainerConfigs[TrainerType.ACE_TRAINER]);

    this.variant = variant;
    this.partyTemplateIndex = Math.min(
      partyTemplateIndex === undefined ? randSeedItem(this.config.partyTemplates.map((_, i) => i)) : partyTemplateIndex,
      this.config.partyTemplates.length - 1,
    );
    // TODO: Rework this and add actual error handling for missing names
    const classKey = `trainersCommon:${toCamelCase(TrainerType[trainerType])}`;
    if (i18next.exists(classKey, { returnObjects: true })) {
      if (nameKey) {
        this.nameKey = nameKey;
        this.name = i18next.t(nameKey);
      } else {
        const genderKey = i18next.exists(`${classKey}.male`)
          ? variant === TrainerVariant.FEMALE
            ? ".female"
            : ".male"
          : "";
        [this.nameKey, this.name] = getRandomLocaleEntry(`${classKey}${genderKey}`);
      }

      if (variant === TrainerVariant.DOUBLE) {
        if (this.config.doubleOnly) {
          if (partnerNameKey) {
            this.partnerNameKey = partnerNameKey;
            this.partnerName = i18next.t(this.partnerNameKey);
          } else {
            [this.name, this.partnerName] = this.name.split(" & ");
          }
        } else {
          const partnerGenderKey = i18next.exists(`${classKey}.female`) ? ".female" : "";
          [this.partnerNameKey, this.partnerName] = getRandomLocaleEntry(`${classKey}${partnerGenderKey}`);
        }
      }
    }

    switch (this.variant) {
      case TrainerVariant.FEMALE:
        if (!this.config.hasGenders) {
          variant = TrainerVariant.DEFAULT;
        }
        break;
      case TrainerVariant.DOUBLE:
        if (!this.config.hasDouble) {
          variant = TrainerVariant.DEFAULT;
        }
        break;
    }

    const getSprite = (hasShadow?: boolean, forceFemale?: boolean) => {
      const ret = globalScene.addFieldSprite(
        0,
        0,
        this.config.getSpriteKey(variant === TrainerVariant.FEMALE || forceFemale, this.isDouble()),
      );
      ret.setOrigin(0.5, 1);
      ret.setPipeline(globalScene.spritePipeline, {
        tone: [0.0, 0.0, 0.0, 0.0],
        hasShadow: !!hasShadow,
      });
      return ret;
    };

    const sprite = getSprite(true);
    const tintSprite = getSprite();

    tintSprite.setVisible(false);

    this.add(sprite);
    this.add(tintSprite);

    if (variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      const partnerSprite = getSprite(true, true);
      const partnerTintSprite = getSprite(false, true);

      partnerTintSprite.setVisible(false);

      sprite.x = -4;
      tintSprite.x = -4;
      partnerSprite.x = 28;
      partnerTintSprite.x = 28;

      this.add(partnerSprite);
      this.add(partnerTintSprite);
    }
  }

  getKey(forceFemale?: boolean): string {
    return this.config.getSpriteKey(this.variant === TrainerVariant.FEMALE || forceFemale, this.isDouble());
  }

  /**
   * Returns the name of the trainer based on the provided trainer slot and the option to include a title.
   * @param trainerSlot - The slot to determine which name to use; default `TrainerSlot.NONE`
   * @param includeTitle - Whether to include the title in the returned name; default `false`
   * @returns - The formatted name of the trainer
   */
  getName(trainerSlot: TrainerSlot = TrainerSlot.NONE, includeTitle = false): string {
    // Get the base title based on the trainer slot and variant.
    let name = this.config.getTitle(trainerSlot, this.variant);

    // Determine the title to include based on the configuration and includeTitle flag.
    let title = includeTitle && this.config.title ? this.config.title : null;
    const evilTeamTitles = ["grunt"];
    if (this.name === "" && evilTeamTitles.some(t => name.toLocaleLowerCase().includes(t))) {
      // This is a evil team grunt so we localize it by only using the "name" as the title
      title = i18next.t(`trainerClasses:${toCamelCase(name)}`);
      console.log("Localized grunt name: " + title);
      // Since grunts are not named we can just return the title
      return title;
    }

    // If the trainer has a name (not null or undefined).
    if (this.name) {
      // If the title should be included.
      if (includeTitle) {
        // Get the localized trainer class name from the i18n file and set it as the title.
        // This is used for trainer class names, not titles like "Elite Four, Champion, etc."
        title = i18next.t(`trainerClasses:${toCamelCase(name)}`);
      }

      // If no specific trainer slot is set.
      if (trainerSlot) {
        // Assign the name based on the trainer slot:
        // Use 'this.name' if 'trainerSlot' is TRAINER.
        // Otherwise, use 'this.partnerName' if it exists, or 'this.name' if it doesn't.
        name = trainerSlot === TrainerSlot.TRAINER ? this.name : this.partnerName || this.name;
      } else {
        // Use the trainer's name.
        name = this.name;
        // If there is a partner name, concatenate it with the trainer's name using "&".
        if (this.partnerName) {
          name = `${name} & ${this.partnerName}`;
        }
      }
    }

    if (this.config.titleDouble && this.variant === TrainerVariant.DOUBLE && !this.config.doubleOnly) {
      title = this.config.titleDouble;
      name = i18next.t(`trainerNames:${toCamelCase(this.config.nameDouble)}`);
    }

    console.log(title ? `${title} ${name}` : name);

    // Return the formatted name, including the title if it is set.
    return title ? `${title} ${name}` : name;
  }

  isDouble(): boolean {
    return this.config.doubleOnly || this.variant === TrainerVariant.DOUBLE;
  }

  /**
   * Return whether the trainer is a duo, like Tate & Liza
   */
  isPartner(): boolean {
    return this.variant === TrainerVariant.DOUBLE;
  }

  /**
   * Whether this trainer was built with a SEPARATE partner trainer sprite (a true two-trainer
   * duo like Tate & Liza). The ctor only adds the partner sprite pair when the EFFECTIVE sprite
   * variant is DOUBLE, i.e. it demotes to a single sprite pair when `!config.hasDouble` (see the
   * `switch (this.variant)` demotion + the `variant === DOUBLE && !doubleOnly` guard in the ctor).
   *
   * A co-op / doubles-challenge force-double against a NORMAL single trainer keeps
   * `this.variant === DOUBLE` for GAMEPLAY (both players get an enemy-facing slot, two enemy mons)
   * but has hasDouble=false, so only ONE trainer sprite exists. The sprite accessors below must
   * agree with that construction guard - reading `this.variant` alone makes them index a partner
   * sprite that was never added and throw at the trainer summon (`initSprite`/`getSprites`).
   * `doubleOnly` classes render a single combined sprite, so they are excluded too.
   */
  private hasPartnerSprite(): boolean {
    return this.variant === TrainerVariant.DOUBLE && this.config.hasDouble && !this.config.doubleOnly;
  }

  getMixedBattleBgm(): string {
    return this.config.mixedBattleBgm;
  }

  getBattleBgm(): string {
    return this.config.battleBgm;
  }

  getEncounterBgm(): string {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE ? this.config.doubleEncounterBgm : this.config.femaleEncounterBgm)
          || this.config.encounterBgm
      : this.config.encounterBgm;
  }

  getEncounterMessages(): string[] {
    if (this.encounterMessagesOverride && this.encounterMessagesOverride.length > 0) {
      return this.encounterMessagesOverride;
    }
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE
          ? this.config.doubleEncounterMessages
          : this.config.femaleEncounterMessages) || this.config.encounterMessages
      : this.config.encounterMessages;
  }

  getVictoryMessages(): string[] {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE ? this.config.doubleVictoryMessages : this.config.femaleVictoryMessages)
          || this.config.victoryMessages
      : this.config.victoryMessages;
  }

  getDefeatMessages(): string[] {
    return this.variant
      ? (this.variant === TrainerVariant.DOUBLE ? this.config.doubleDefeatMessages : this.config.femaleDefeatMessages)
          || this.config.defeatMessages
      : this.config.defeatMessages;
  }

  getPartyTemplate(): TrainerPartyTemplate {
    if (this.config.partyTemplateFunc) {
      return this.config.partyTemplateFunc();
    }
    return this.config.partyTemplates[this.partyTemplateIndex];
  }

  getPartyLevels(waveIndex: number): number[] {
    const ret: number[] = [];
    const partyTemplate = this.getPartyTemplate();

    const difficultyWaveIndex = globalScene.gameMode.getWaveForDifficulty(waveIndex);
    const baseLevel = 1 + difficultyWaveIndex / 2 + Math.pow(difficultyWaveIndex / 25, 2);

    // ER (#383): the Doubles Only challenge forces every trainer battle
    // double, but only double-VARIANT trainers grew their party to 2 here.
    // A single-mon trainer in a forced double battle left the second enemy
    // slot permanently unfillable and the battle froze (community report).
    //
    // ER (#633 co-op): co-op ALSO forces every trainer battle to a double
    // (so each of the two players controls one enemy-facing slot) - via
    // `battle.double`, NOT the DOUBLES_ONLY challenge - so an early single
    // trainer (e.g. the first wave-4/5 trainer) hit the exact same unfillable
    // 2nd-slot freeze on EVERY co-op run. Gate the party-size bump on the
    // actual forced-double state too. Solo / normal play is unaffected (its
    // early trainers stay single, so this branch never runs there).
    const erForcedDouble =
      (globalScene.gameMode?.hasChallenge?.(Challenges.DOUBLES_ONLY) ?? false)
      || (globalScene.gameMode?.isCoop ?? false);
    if ((this.isDouble() || erForcedDouble) && partyTemplate.size < 2) {
      partyTemplate.size = 2;
    }

    for (let i = 0; i < partyTemplate.size; i++) {
      let multiplier = 1;

      const strength = partyTemplate.getStrength(i);

      switch (strength) {
        case PartyMemberStrength.WEAKER:
          multiplier = 0.95;
          break;
        case PartyMemberStrength.WEAK:
          multiplier = 1.0;
          break;
        case PartyMemberStrength.AVERAGE:
          multiplier = 1.1;
          break;
        case PartyMemberStrength.STRONG:
          multiplier = 1.2;
          break;
        case PartyMemberStrength.STRONGER:
          multiplier = 1.25;
          break;
      }

      let levelOffset = 0;

      if (strength < PartyMemberStrength.STRONG) {
        multiplier = Math.min(multiplier + 0.025 * Math.floor(difficultyWaveIndex / 25), 1.2);
        levelOffset = -Math.floor((difficultyWaveIndex / 50) * (PartyMemberStrength.STRONG - strength));
      }

      const level = Math.ceil(baseLevel * multiplier) + levelOffset;
      ret.push(level);
    }

    return ret;
  }

  genPartyMember(index: number): EnemyPokemon {
    const battle = globalScene.currentBattle;
    const level = battle.enemyLevels?.[index]!; // TODO: is this bang correct?

    let ret: EnemyPokemon;

    globalScene.executeWithSeedOffset(
      () => {
        const template = this.getPartyTemplate();
        const strength: PartyMemberStrength = template.getStrength(index);

        // Showdown 1v1 hook (C3): a trainer flagged as the showdown OPPONENT fields the
        // negotiated manifest team VERBATIM (built from the opponent manifest, BST-curve exempt).
        // Checked FIRST - it wins over every roster/rival/ghost override for the duel.
        const showdown = applyShowdownOverride(this, index);
        if (showdown !== null) {
          ret = showdown;
          return;
        }

        // ER ghost hook (#217): if this trainer was flagged as a cross-player
        // "ghost" (endgame gauntlet), field the stored team. Checked FIRST so it
        // wins over the rival / ER-roster overrides and the trainer's own funcs.
        const erGhost = applyErGhostOverride(this, index);
        if (erGhost !== null) {
          ret = erGhost;
          return;
        }

        // ER rival hook (Elite/Hell only): mirror the Hoenn rival (May/Brendan)
        // onto PokeRogue's RIVAL..RIVAL_6 encounters. Checked BEFORE the rival's
        // own `partyMemberFuncs` below, because the rival defines its entire team
        // through those funcs — so the ER roster must win first. Returns null for
        // non-rival (or Ace) trainers and for indices beyond the ER rival roster
        // (those fall through to the vanilla rival member).
        const erRival = applyErRivalOverride(this, index);
        if (erRival !== null) {
          ret = erRival;
          return;
        }

        // ER factory hook (#347): a small seeded fraction of Elite/Hell regular
        // trainer waves fields a Battle-Factory competitive team instead of an
        // ER roster (pool variety). Before partyMemberFuncs so a factory team
        // fully replaces the trainer's scripted picks.
        const erFactory = applyErFactoryOverride(this, index);
        if (erFactory !== null) {
          ret = erFactory;
          return;
        }

        // If the battle is not one of the named trainer doubles
        if (!(this.config.trainerTypeDouble && this.isDouble() && !this.config.doubleOnly)) {
          if (Object.hasOwn(this.config.partyMemberFuncs, index)) {
            ret = this.config.partyMemberFuncs[index](level, strength);
            return;
          }
          if (Object.hasOwn(this.config.partyMemberFuncs, index - template.size)) {
            ret = this.config.partyMemberFuncs[index - template.size](level, template.getStrength(index));
            return;
          }
        }

        // ER trainer-overlay hook: if this trainer's class matches an ER
        // registry entry AND no explicit partyMemberFunc (LLM director /
        // mystery encounter) won above, replace the rolled species /
        // moveset / IVs with the ER roster. Returns null for non-ER
        // trainers (or members beyond the ER roster length) and vanilla
        // pokerogue generation continues unchanged below.
        const erEnemy = applyErRosterOverride(this, index);
        if (erEnemy !== null) {
          ret = erEnemy;
          return;
        }
        let offset = 0;

        if (template instanceof TrainerPartyCompoundTemplate) {
          for (const innerTemplate of template.templates) {
            if (offset + innerTemplate.size > index) {
              break;
            }
            offset += innerTemplate.size;
          }
        }

        // Create an empty species pool (which will be set to one of the species pools based on the index)
        let newSpeciesPool: SpeciesId[] = [];
        let useNewSpeciesPool = false;

        // If we are in a double battle of named trainers, we need to use alternate species pools (generate half the party from each trainer)
        if (this.config.trainerTypeDouble && this.isDouble() && !this.config.doubleOnly) {
          // Use the new species pool for this party generation
          useNewSpeciesPool = true;

          // Get the species pool for the partner trainer and the current trainer
          const speciesPoolPartner = signatureSpecies[TrainerType[this.config.trainerTypeDouble]];
          const speciesPool = signatureSpecies[TrainerType[this.config.trainerType]];

          // Get the species that are already in the enemy party so we dont generate the same species twice
          const AlreadyUsedSpecies = battle.enemyParty.map(p => p.species.speciesId);

          // Filter out the species that are already in the enemy party from the main trainer species pool
          const speciesPoolFiltered = speciesPool
            .filter(species => {
              // Since some species pools have arrays in them (use either of those species), we need to check if one of the species is already in the party and filter the whole array if it is
              if (Array.isArray(species)) {
                return !species.some(s => AlreadyUsedSpecies.includes(s));
              }
              return !AlreadyUsedSpecies.includes(species);
            })
            .flat();

          // Filter out the species that are already in the enemy party from the partner trainer species pool
          const speciesPoolPartnerFiltered = speciesPoolPartner
            .filter(species => {
              // Since some species pools have arrays in them (use either of those species), we need to check if one of the species is already in the party and filter the whole array if it is
              if (Array.isArray(species)) {
                return !species.some(s => AlreadyUsedSpecies.includes(s));
              }
              return !AlreadyUsedSpecies.includes(species);
            })
            .flat();

          // If the index is even, use the species pool for the main trainer (that way he only uses his own pokemon in battle)
          if (!(index % 2)) {
            // Since the only currently allowed double battle with named trainers is Tate & Liza, we need to make sure that Solrock is the first pokemon in the party for Tate and Lunatone for Liza
            if (index === 0 && TrainerType[this.config.trainerType] === TrainerType[TrainerType.TATE]) {
              newSpeciesPool = [SpeciesId.SOLROCK];
            } else if (index === 0 && TrainerType[this.config.trainerType] === TrainerType[TrainerType.LIZA]) {
              newSpeciesPool = [SpeciesId.LUNATONE];
            } else {
              newSpeciesPool = speciesPoolFiltered;
            }
            // If the index is odd, use the species pool for the partner trainer (that way he only uses his own pokemon in battle)
            // Since the only currently allowed double battle with named trainers is Tate & Liza, we need to make sure that Solrock is the first pokemon in the party for Tate and Lunatone for Liza
          } else if (index === 1 && TrainerType[this.config.trainerTypeDouble] === TrainerType[TrainerType.TATE]) {
            newSpeciesPool = [SpeciesId.SOLROCK];
          } else if (index === 1 && TrainerType[this.config.trainerTypeDouble] === TrainerType[TrainerType.LIZA]) {
            newSpeciesPool = [SpeciesId.LUNATONE];
          } else {
            newSpeciesPool = speciesPoolPartnerFiltered;
          }
          // Fallback for when the species pool is empty
          if (newSpeciesPool.length === 0) {
            // If all pokemon from this pool are already in the party, generate a random species
            useNewSpeciesPool = false;
          }
        }

        // If useNewSpeciesPool is true, we need to generate a new species from the new species pool, otherwise we generate a random species
        let species = useNewSpeciesPool
          ? // TODO: should this use `randSeedItem`?
            getPokemonSpecies(newSpeciesPool[Math.floor(randSeedInt(newSpeciesPool.length))])
          : template.isSameSpecies(index) && index > offset
            ? getPokemonSpecies(
                battle.enemyParty[offset].species.getTrainerSpeciesForLevel(
                  level,
                  false,
                  template.getStrength(offset),
                  template.evoLevelThresholdKind,
                ),
              )
            : this.genNewPartyMemberSpecies(level, strength);

        // If the species is from newSpeciesPool, we need to adjust it based on the level and strength
        if (newSpeciesPool) {
          species = getPokemonSpecies(
            species.getSpeciesForLevel(level, true, true, strength, template.evoLevelThresholdKind),
          );
        }

        ret = globalScene.addEnemyPokemon(
          species,
          level,
          !this.isDouble() || !(index % 2) ? TrainerSlot.TRAINER : TrainerSlot.TRAINER_PARTNER,
        );
      },
      this.config.hasStaticParty
        ? this.config.getDerivedType() + ((index + 1) << 8)
        : globalScene.currentBattle.waveIndex
            + (this.config.getDerivedType() << 10)
            + (((this.config.useSameSeedForAllMembers ? 0 : index) + 1) << 8),
    );

    return ret!; // TODO: is this bang correct?
  }

  genNewPartyMemberSpecies(level: number, strength: PartyMemberStrength, attempt?: number): PokemonSpecies {
    const battle = globalScene.currentBattle;
    const template = this.getPartyTemplate();
    let baseSpecies: PokemonSpecies;
    if (this.config.speciesPools) {
      const tierValue = randSeedInt(512);
      let tier: TrainerPoolTier;
      if (tierValue >= 156) {
        tier = TrainerPoolTier.COMMON;
      } else if (tierValue >= 32) {
        tier = TrainerPoolTier.UNCOMMON;
      } else if (tierValue >= 6) {
        tier = TrainerPoolTier.RARE;
      } else if (tierValue >= 1) {
        tier = TrainerPoolTier.SUPER_RARE;
      } else {
        tier = TrainerPoolTier.ULTRA_RARE;
      }
      console.log(TrainerPoolTier[tier]);
      while (!Object.hasOwn(this.config.speciesPools, tier) || this.config.speciesPools[tier].length === 0) {
        console.log(
          `Downgraded trainer Pokemon rarity tier from ${TrainerPoolTier[tier]} to ${TrainerPoolTier[tier - 1]}`,
        );
        tier--;
      }
      const tierPool = this.config.speciesPools[tier];
      let rolledSpecies = randSeedItem(tierPool);
      while (typeof rolledSpecies !== "number") {
        rolledSpecies = randSeedItem(tierPool);
      }
      baseSpecies = getPokemonSpecies(rolledSpecies);
    } else {
      baseSpecies = globalScene.randomSpecies(battle.waveIndex, level, false, this.config.speciesFilter);
    }

    let ret = getPokemonSpecies(
      baseSpecies.getTrainerSpeciesForLevel(level, true, strength, template.evoLevelThresholdKind),
    );
    let retry = false;

    console.log(ret.getName());

    if (Object.hasOwn(pokemonPrevolutions, baseSpecies.speciesId) && ret.speciesId !== baseSpecies.speciesId) {
      retry = true;
    } else if (template.isBalanced(battle.enemyParty.length)) {
      const partyMemberTypes = battle.enemyParty.flatMap(p => p.getTypes(true));
      if (
        partyMemberTypes.indexOf(ret.type1) > -1
        || (ret.type2 !== null && partyMemberTypes.indexOf(ret.type2) > -1)
      ) {
        retry = true;
      }
    }

    // Prompts reroll of party member species if doesn't fit specialty type.
    // Can be removed by adding a type parameter to getTrainerSpeciesForLevel and filtering the list of evolutions for that type.
    if (!retry && this.config.hasSpecialtyType() && !ret.isOfType(this.config.specialtyType)) {
      retry = true;
      console.log("Attempting reroll of species evolution to fit specialty type...");
      let evoAttempt = 0;
      while (retry && evoAttempt++ < 10) {
        ret = getPokemonSpecies(
          baseSpecies.getTrainerSpeciesForLevel(level, true, strength, template.evoLevelThresholdKind),
        );
        console.log(ret.name);
        if (ret.isOfType(this.config.specialtyType)) {
          retry = false;
        }
      }
    }

    // Prompts reroll of party member species if species already present in the enemy party
    if (this.checkDuplicateSpecies(baseSpecies.speciesId)) {
      console.log("Duplicate species detected, prompting reroll...");
      retry = true;
    }

    if (retry && (attempt ?? 0) < 10) {
      console.log("Rerolling party member...");
      ret = this.genNewPartyMemberSpecies(level, strength, (attempt ?? 0) + 1);
    }

    return ret;
  }

  /**
   * Checks if the enemy trainer already has the Pokemon species in their party
   * @param baseSpecies - The base {@linkcode SpeciesId} of the current Pokemon
   * @returns `true` if the species is already present in the party
   */
  checkDuplicateSpecies(baseSpecies: SpeciesId): boolean {
    const staticSpecies = (signatureSpecies[TrainerType[this.config.trainerType]] ?? []).flat(1).map(s => {
      let root = s;
      while (Object.hasOwn(pokemonPrevolutions, root)) {
        root = pokemonPrevolutions[root];
      }
      return root;
    });

    const currentSpecies = globalScene.getEnemyParty().map(p => {
      return p.species.getRootSpeciesId();
    });

    return currentSpecies.includes(baseSpecies) || staticSpecies.includes(baseSpecies);
  }

  getPartyMemberMatchupScores(
    trainerSlot: TrainerSlot = TrainerSlot.NONE,
    forSwitch = false,
    useBestMove = false,
  ): [number, number][] {
    // Slot-gating is only meaningful when the BATTLE is a partnered double. A
    // double-VARIANT trainer rolled into a SINGLE battle assigns alternating
    // trainerSlots at party gen (see the ctor), so gating by variant alone left
    // its slot-2 reserves unsendable - the fainted lead sat on an empty field
    // and the fight soft-locked (found by the headless full-run harness).
    if (trainerSlot && !(this.isDouble() && globalScene.currentBattle?.double)) {
      trainerSlot = TrainerSlot.NONE;
    }

    const party = globalScene.getEnemyParty();
    const nonFaintedLegalPartyMembers = party
      .slice(globalScene.currentBattle.getBattlerCount())
      .filter(p => p.isAllowedInBattle())
      .filter(p => !trainerSlot || p.trainerSlot === trainerSlot);
    const partyMemberScores = nonFaintedLegalPartyMembers.map(p => {
      const playerField = globalScene.getPlayerField().filter(p => p.isAllowedInBattle());
      let score = 0;

      if (playerField.length > 0) {
        for (const playerPokemon of playerField) {
          score += p.getMatchupScore(playerPokemon, useBestMove);
          if (playerPokemon.species.legendary) {
            score /= 2;
          }
        }
        score /= playerField.length;
        if (forSwitch && !p.isOnField()) {
          globalScene.arena
            .findTagsOnSide(t => t instanceof EntryHazardTag, ArenaTagSide.ENEMY)
            .map(t => (score *= (t as EntryHazardTag).getMatchupScoreMultiplier(p)));
        }
      }

      return [party.indexOf(p), score];
    }) as [number, number][];

    return partyMemberScores;
  }

  getSortedPartyMemberMatchupScores(partyMemberScores: [number, number][] = this.getPartyMemberMatchupScores()) {
    const sortedPartyMemberScores = partyMemberScores.slice(0);
    sortedPartyMemberScores.sort((a, b) => {
      const scoreA = a[1];
      const scoreB = b[1];
      return scoreA < scoreB ? 1 : scoreA > scoreB ? -1 : 0;
    });

    return sortedPartyMemberScores;
  }

  getNextSummonIndex(
    trainerSlot: TrainerSlot = TrainerSlot.NONE,
    // ER (Slice 2): forced/faint replacements (callers that don't pass scores)
    // become hazard-aware (forSwitch) AND best-move-aware on Elite/Hell, so the
    // AI stops sending a hazard-weak mon into its own Rocks after a KO.
    partyMemberScores: [number, number][] = this.getPartyMemberMatchupScores(
      trainerSlot,
      isErSmartSwitching(),
      isErSmartSwitching(),
    ),
  ): number {
    // Same battle-format guard as getPartyMemberMatchupScores: variant-double
    // trainers in a SINGLE battle must ignore trainerSlot or their slot-2
    // reserves can never be summoned.
    if (trainerSlot && !(this.isDouble() && globalScene.currentBattle?.double)) {
      trainerSlot = TrainerSlot.NONE;
    }

    const sortedPartyMemberScores = this.getSortedPartyMemberMatchupScores(partyMemberScores);

    // ER (#400): with NO benched member left (e.g. the second faint of a
    // double KO when only one reserve existed), indexing the empty score list
    // threw mid-phase and hard-froze the battle. Report "nobody" instead.
    if (sortedPartyMemberScores.length === 0) {
      return -1;
    }

    const maxScorePartyMemberIndexes = partyMemberScores
      .filter(pms => pms[1] === sortedPartyMemberScores[0][1])
      .map(pms => pms[0]);

    if (maxScorePartyMemberIndexes.length > 1) {
      let rand: number;
      // TODO: should this use `randSeedItem`?

      globalScene.executeWithSeedOffset(
        () => (rand = randSeedInt(maxScorePartyMemberIndexes.length)),
        globalScene.currentBattle.turn << 2,
      );
      return maxScorePartyMemberIndexes[rand!];
    }

    return maxScorePartyMemberIndexes[0];
  }

  getPartyMemberModifierChanceMultiplier(index: number): number {
    switch (this.getPartyTemplate().getStrength(index)) {
      case PartyMemberStrength.WEAKER:
        return 0.75;
      case PartyMemberStrength.WEAK:
        return 0.675;
      case PartyMemberStrength.AVERAGE:
        return 0.5625;
      case PartyMemberStrength.STRONG:
        return 0.45;
      case PartyMemberStrength.STRONGER:
        return 0.375;
      default:
        console.warn("getPartyMemberModifierChanceMultiplier not defined. Using default 0");
        return 0;
    }
  }

  genModifiers(party: readonly EnemyPokemon[]): PersistentModifier[] {
    if (this.config.genModifiersFunc) {
      return this.config.genModifiersFunc(party);
    }
    return [];
  }

  genAI(party: readonly EnemyPokemon[]) {
    if (this.config.genAIFuncs) {
      this.config.genAIFuncs.forEach(f => f(party));
    }
    console.log("Generated AI funcs");
  }

  loadAssets(): Promise<void> {
    return this.config.loadAssets(this.variant);
  }

  initSprite(): void {
    this.getSprites().map((sprite, i) => sprite.setTexture(this.getKey(!!i)).setFrame(0));
    this.getTintSprites().map((tintSprite, i) => tintSprite.setTexture(this.getKey(!!i)).setFrame(0));
  }

  /**
   * Attempts to animate a given set of {@linkcode Phaser.GameObjects.Sprite}
   * @see {@linkcode Phaser.GameObjects.Sprite.play}
   * @param sprite {@linkcode Phaser.GameObjects.Sprite} to animate
   * @param tintSprite {@linkcode Phaser.GameObjects.Sprite} placed on top of the sprite to add a color tint
   * @param animConfig {@linkcode Phaser.Types.Animations.PlayAnimationConfig} to pass to {@linkcode Phaser.GameObjects.Sprite.play}
   * @returns true if the sprite was able to be animated
   */
  tryPlaySprite(
    sprite: Phaser.GameObjects.Sprite,
    tintSprite: Phaser.GameObjects.Sprite,
    animConfig: Phaser.Types.Animations.PlayAnimationConfig,
  ): boolean {
    // Show an error in the console if there isn't a texture loaded
    if (sprite.texture.key === "__MISSING") {
      console.error(`No texture found for '${animConfig.key}'!`);

      return false;
    }
    // Don't try to play an animation when there isn't one
    if (sprite.texture.frameTotal <= 1) {
      console.warn(`No animation found for '${animConfig.key}'. Is this intentional?`);

      return false;
    }

    sprite.play(animConfig);
    tintSprite.play(animConfig);

    return true;
  }

  playAnim(): void {
    const trainerAnimConfig = {
      key: this.getKey(),
      repeat: 0,
      startFrame: 0,
    };
    const sprites = this.getSprites();
    const tintSprites = this.getTintSprites();

    this.tryPlaySprite(sprites[0], tintSprites[0], trainerAnimConfig);

    // Queue an animation for the second trainer if this is a double battle against two separate trainers
    if (this.hasPartnerSprite()) {
      const partnerTrainerAnimConfig = {
        key: this.getKey(true),
        repeat: 0,
        startFrame: 0,
      };

      this.tryPlaySprite(sprites[1], tintSprites[1], partnerTrainerAnimConfig);
    }
  }

  getSprites(): Phaser.GameObjects.Sprite[] {
    const ret: Phaser.GameObjects.Sprite[] = [this.getAt(0)];
    if (this.hasPartnerSprite()) {
      ret.push(this.getAt(2));
    }
    return ret;
  }

  getTintSprites(): Phaser.GameObjects.Sprite[] {
    const ret: Phaser.GameObjects.Sprite[] = [this.getAt(1)];
    if (this.hasPartnerSprite()) {
      ret.push(this.getAt(3));
    }
    return ret;
  }

  tint(color: number, alpha?: number, duration?: number, ease?: string): void {
    const tintSprites = this.getTintSprites();
    tintSprites.map(tintSprite => {
      tintSprite.setTintFill(color);
      tintSprite.setVisible(true);

      if (duration) {
        tintSprite.setAlpha(0);

        globalScene.tweens.add({
          targets: tintSprite,
          alpha: alpha || 1,
          duration,
          ease: ease || "Linear",
        });
      } else {
        tintSprite.setAlpha(alpha);
      }
    });
  }

  untint(duration: number, ease?: string): void {
    const tintSprites = this.getTintSprites();
    tintSprites.map(tintSprite => {
      if (duration) {
        globalScene.tweens.add({
          targets: tintSprite,
          alpha: 0,
          duration,
          ease: ease || "Linear",
          onComplete: () => {
            tintSprite.setVisible(false);
            tintSprite.setAlpha(1);
          },
        });
      } else {
        tintSprite.setVisible(false);
        tintSprite.setAlpha(1);
      }
    });
  }

  /**
   * Determines whether a Trainer should Terastallize their Pokemon
   * @param pokemon {@linkcode EnemyPokemon} Trainer Pokemon in question
   * @returns boolean Whether the EnemyPokemon should Terastalize this turn
   */
  shouldTera(pokemon: EnemyPokemon): boolean {
    if (
      this.config.trainerAI.teraMode === TeraAIMode.INSTANT_TERA
      && !pokemon.isTerastallized
      && this.config.trainerAI.instantTeras.includes(pokemon.initialTeamIndex)
      && !globalScene.currentBattle.enemyFaintsHistory.some(f => f.pokemon.id === pokemon.id)
    ) {
      return true;
    }
    return false;
  }

  /**
   * ER Ghost Trainer FX: build + start the equipped aura overlay around this
   * trainer's visible sprite(s). No-op when no aura is equipped or one is already
   * running. Called once the trainer is revealed on the field (encounter-phase).
   */
  applyErGhostAuraFx(): void {
    if (!this.erGhostAura || this.erAuraFx) {
      return;
    }
    this.erAuraFx = new ErTrainerAuraFx(this, this.getSprites(), this.erGhostAura, this.erAuraFxKey, {
      speed: this.erGhostFxSpeed,
      intensity: this.erGhostFxIntensity,
    });
    this.erAuraFx.start();
  }

  /** ER Ghost Trainer FX: tear down the aura overlay + its refresh timer. */
  removeErGhostAuraFx(): void {
    this.erAuraFx?.destroy();
    this.erAuraFx = null;
  }

  override destroy(fromScene?: boolean): void {
    this.removeErGhostAuraFx();
    super.destroy(fromScene);
  }
}
