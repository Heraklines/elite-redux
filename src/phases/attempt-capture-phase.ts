import { PLAYER_PARTY_MAX_SIZE } from "#app/constants";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { IS_TEST, isBeta, isDev } from "#constants/app-constants";
import { SubstituteTag } from "#data/battler-tags";
import { coopAllowAccountWrite } from "#data/elite-redux/coop/coop-account-gate";
import { coopHostAwaitWildCatchFullSlot } from "#data/elite-redux/coop/coop-catch-full";
import {
  broadcastCoopWaveResolved,
  getCoopController,
  getCoopInteractionRelay,
} from "#data/elite-redux/coop/coop-runtime";
import { coopAttributeNewMon, setCoopCatchThrowerHint } from "#data/elite-redux/coop/coop-session";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import { erRecordAchievementCatch, erRecordAchievementRelease } from "#data/elite-redux/er-achievement-tracker";
import { communitySpeciesAllowed } from "#data/elite-redux/er-community-run-state";
import { erCollectorsAlbumRecordCatch } from "#data/elite-redux/er-relics";
import { Gender } from "#data/gender";
import {
  doPokeballBounceAnim,
  getCriticalCaptureChance,
  getPokeballAtlasKey,
  getPokeballCatchMultiplier,
  getPokeballTintColor,
} from "#data/pokeball";
import { getStatusEffectCatchRateMultiplier } from "#data/status-effect";
import { ChallengeType } from "#enums/challenge-type";
import type { PokeballType } from "#enums/pokeball";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonPhase } from "#phases/pokemon-phase";
import { achvs } from "#system/achv";
import type { PartyOption } from "#ui/party-ui-handler";
import { PartyUiMode } from "#ui/party-ui-handler";
import { SummaryUiMode } from "#ui/summary-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder } from "#utils/common";
import i18next from "i18next";

// TODO: Refactor and split up to allow for overriding capture chance
export class AttemptCapturePhase extends PokemonPhase {
  public readonly phaseName = "AttemptCapturePhase";
  private readonly targetPokemon: EnemyPokemon;
  private readonly pokeballType: PokeballType;
  private pokeball: Phaser.GameObjects.Sprite;
  private originalY: number;

  /** Co-op (#800): the BALL-THROWER's role, pinned for attribution while this capture resolves. */
  private readonly throwerRole: CoopRole | undefined;

  constructor(targetPokemon: EnemyPokemon, pokeballType: PokeballType, throwerRole?: CoopRole) {
    super(targetPokemon.getBattlerIndex());

    this.targetPokemon = targetPokemon;
    this.pokeballType = pokeballType;
    this.throwerRole = throwerRole;
  }

  public override getPokemon(): EnemyPokemon {
    return this.targetPokemon;
  }

  public override end(): void {
    // The hint only means anything while THIS capture resolves.
    setCoopCatchThrowerHint(null);
    super.end();
  }

  start() {
    // Co-op (#800): attribute the catch to the ACTUAL thrower (when their half has room)
    // instead of pure half-balancing - "I caught it" must mean "it is mine".
    setCoopCatchThrowerHint(this.throwerRole ?? null);
    super.start();

    const pokemon = this.getPokemon();

    // A BALL command may be relayed or sit queued while field occupancy changes. It must
    // never fall back to a same-numbered player slot when its enemy target is stale.
    if (!pokemon.hp || !globalScene.getEnemyField(true).includes(pokemon)) {
      return this.end();
    }

    const substitute = pokemon.getTag(SubstituteTag);
    if (substitute) {
      substitute.sprite.setVisible(false);
    }

    globalScene.pokeballCounts[this.pokeballType]--;
    globalScene.currentBattle.recordUsedPokeball(this.pokeballType);

    this.originalY = pokemon.y;

    const _3m = 3 * pokemon.getMaxHp();
    const _2h = 2 * pokemon.hp;
    const catchRate = pokemon.species.catchRate;
    const pokeballMultiplier = getPokeballCatchMultiplier(this.pokeballType);
    const statusMultiplier = pokemon.status ? getStatusEffectCatchRateMultiplier(pokemon.status.effect) : 1;
    const shinyMultiplier = pokemon.isShiny() ? timedEventManager.getShinyCatchMultiplier() : 1;
    const modifiedCatchRate = Math.round(
      (((_3m - _2h) * catchRate * pokeballMultiplier) / _3m) * statusMultiplier * shinyMultiplier,
    );
    const shakeProbability = Math.round(65536 / Math.pow(255 / modifiedCatchRate, 0.1875)); // Formula taken from gen 6
    const criticalCaptureChance = getCriticalCaptureChance(modifiedCatchRate);

    if ((isBeta || isDev) && !IS_TEST) {
      console.log(
        "Base Catch Rate: %d\nBall Mult: %d\nStatus Mult: %d\nShiny Bonus: %d\nModified Catch Rate: %d\nShake Probability: %d\nCritical Catch Chance: %d",
        catchRate,
        pokeballMultiplier,
        statusMultiplier,
        shinyMultiplier,
        modifiedCatchRate,
        shakeProbability,
        criticalCaptureChance,
      );
    }

    const isCritical = pokemon.randBattleSeedInt(256) < criticalCaptureChance;
    const fpOffset = pokemon.getFieldPositionOffset();

    const pokeballAtlasKey = getPokeballAtlasKey(this.pokeballType);
    this.pokeball = globalScene.addFieldSprite(16, 80, "pb", pokeballAtlasKey);
    this.pokeball.setOrigin(0.5, 0.625);
    globalScene.field.add(this.pokeball);

    globalScene.playSound(isCritical ? "se/crit_throw" : "se/pb_throw");
    globalScene.time.delayedCall(300, () => {
      globalScene.field.moveBelow(this.pokeball as Phaser.GameObjects.GameObject, pokemon);
    });

    globalScene.tweens.add({
      // Throw animation
      targets: this.pokeball,
      x: { value: 236 + fpOffset[0], ease: "Linear" },
      y: { value: 16 + fpOffset[1], ease: "Cubic.easeOut" },
      duration: 500,
      onComplete: () => {
        // Ball opens
        this.pokeball.setTexture("pb", `${pokeballAtlasKey}_opening`);
        globalScene.time.delayedCall(17, () => this.pokeball.setTexture("pb", `${pokeballAtlasKey}_open`));
        globalScene.playSound("se/pb_rel");
        pokemon.tint(getPokeballTintColor(this.pokeballType));

        globalScene.animations.addPokeballOpenParticles(this.pokeball.x, this.pokeball.y, this.pokeballType);

        globalScene.tweens.add({
          // Mon enters ball
          targets: pokemon,
          duration: 500,
          ease: "Sine.easeIn",
          scale: 0.25,
          y: 20,
          onComplete: () => {
            // Ball closes
            this.pokeball.setTexture("pb", `${pokeballAtlasKey}_opening`);
            pokemon.setVisible(false);
            globalScene.playSound("se/pb_catch");
            globalScene.time.delayedCall(17, () => this.pokeball.setTexture("pb", `${pokeballAtlasKey}`));

            const doShake = () => {
              // After the overall catch rate check, the game does 3 shake checks before confirming the catch.
              let shakeCount = 0;
              const pbX = this.pokeball.x;
              const shakeCounter = globalScene.tweens.addCounter({
                from: 0,
                to: 1,
                repeat: isCritical ? 2 : 4, // Critical captures only perform 1 shake check
                yoyo: true,
                ease: "Cubic.easeOut",
                duration: 250,
                repeatDelay: 500,
                onUpdate: t => {
                  if (shakeCount && shakeCount < (isCritical ? 2 : 4)) {
                    const value = t.getValue() ?? 0;
                    const directionMultiplier = shakeCount % 2 === 1 ? 1 : -1;
                    this.pokeball.setX(pbX + value * 4 * directionMultiplier);
                    this.pokeball.setAngle(value * 27.5 * directionMultiplier);
                  }
                },
                onRepeat: () => {
                  if (shakeCount++ < (isCritical ? 1 : 3)) {
                    // Shake check (skip check for critical or guaranteed captures, but still play the sound)
                    if (
                      pokeballMultiplier === -1
                      || isCritical
                      || modifiedCatchRate >= 255
                      || pokemon.randBattleSeedInt(65536) < shakeProbability
                    ) {
                      globalScene.playSound("se/pb_move");
                    } else {
                      shakeCounter.stop();
                      this.failCatch(shakeCount);
                    }
                  } else if (isCritical && pokemon.randBattleSeedInt(65536) >= shakeProbability) {
                    // Above, perform the one shake check for critical captures after the ball shakes once
                    shakeCounter.stop();
                    this.failCatch(shakeCount);
                  } else {
                    globalScene.playSound("se/pb_lock");
                    globalScene.animations.addPokeballCaptureStars(this.pokeball);

                    const pbTint = globalScene.add.sprite(this.pokeball.x, this.pokeball.y, "pb", "pb");
                    pbTint.setOrigin(this.pokeball.originX, this.pokeball.originY);
                    pbTint.setTintFill(0);
                    pbTint.setAlpha(0);
                    globalScene.field.add(pbTint);
                    globalScene.tweens.add({
                      targets: pbTint,
                      alpha: 0.375,
                      duration: 200,
                      easing: "Sine.easeOut",
                      onComplete: () => {
                        globalScene.tweens.add({
                          targets: pbTint,
                          alpha: 0,
                          duration: 200,
                          easing: "Sine.easeIn",
                          onComplete: () => pbTint.destroy(),
                        });
                      },
                    });
                  }
                },
                onComplete: () => {
                  this.catch();
                },
              });
            };

            // Ball bounces (handled in pokemon.ts)
            globalScene.time.delayedCall(250, () =>
              doPokeballBounceAnim(this.pokeball, 16, 72, 350, doShake, isCritical),
            );
          },
        });
      },
    });
  }

  failCatch(_shakeCount: number) {
    const pokemon = this.getPokemon();

    globalScene.playSound("se/pb_rel");
    pokemon.setY(this.originalY);
    if (pokemon.status?.effect !== StatusEffect.SLEEP) {
      pokemon.cry(pokemon.getHpRatio() > 0.25 ? undefined : { rate: 0.85 });
    }
    pokemon.tint(getPokeballTintColor(this.pokeballType));
    pokemon.setVisible(true);
    pokemon.untint(250, "Sine.easeOut");

    const substitute = pokemon.getTag(SubstituteTag);
    if (substitute) {
      substitute.sprite.setVisible(true);
    }

    const pokeballAtlasKey = getPokeballAtlasKey(this.pokeballType);
    this.pokeball.setTexture("pb", `${pokeballAtlasKey}_opening`);
    globalScene.time.delayedCall(17, () => this.pokeball.setTexture("pb", `${pokeballAtlasKey}_open`));

    globalScene.tweens.add({
      targets: pokemon,
      duration: 250,
      ease: "Sine.easeOut",
      scale: 1,
    });

    globalScene.currentBattle.lastUsedPokeball = this.pokeballType;
    this.removePb();
    this.end();
  }

  catch() {
    const pokemon = this.getPokemon();

    // ER relic (#439): Collector's Album - record this catch against the run's
    // unique-species tally and, on every Nth new species, grant a candy trickle
    // for that species line (no-op unless the relic is held).
    erCollectorsAlbumRecordCatch(pokemon.species.getRootSpeciesId(true));
    erRecordAchievementCatch(pokemon);

    const speciesForm = pokemon.fusionSpecies ? pokemon.getFusionSpeciesForm() : pokemon.getSpeciesForm();

    if (
      speciesForm.abilityHidden
      && (pokemon.fusionSpecies ? pokemon.fusionAbilityIndex : pokemon.abilityIndex)
        === speciesForm.getAbilityCount() - 1
    ) {
      globalScene.validateAchv(achvs.HIDDEN_ABILITY);
    }

    if (pokemon.species.subLegendary) {
      globalScene.validateAchv(achvs.CATCH_SUB_LEGENDARY);
    }

    if (pokemon.species.legendary) {
      globalScene.validateAchv(achvs.CATCH_LEGENDARY);
    }

    if (pokemon.species.mythical) {
      globalScene.validateAchv(achvs.CATCH_MYTHICAL);
    }

    globalScene.pokemonInfoContainer.show(pokemon, true);

    globalScene.gameData.updateSpeciesDexIvs(pokemon.species.getRootSpeciesId(true), pokemon.ivs);

    const addStatus = new BooleanHolder(true);
    // POKEMON_ADD_TO_PARTY is the canonical catch-legality gate: every roster challenge
    // (Mono Type / Generation / Color, Usage Tier, Limited Catch) overrides it. We do NOT
    // additionally run the starter-select legality here - that would wrongly reject catches
    // under starter-only challenges like Fresh Start (which only restricts which mons you
    // START with, not what you can catch mid-run), the reported "Full Reset can't catch" bug.
    applyChallenges(ChallengeType.POKEMON_ADD_TO_PARTY, pokemon, addStatus);

    // ER community challenge: an allowedSpecies whitelist gates mid-run catches the same way
    // it gates the starter grid - an off-list mon is caught (dex-registered) but NOT added to
    // the team, mirroring the usage-tier roster gate. The whitelist is per-run state, not a
    // Challenge object, so it isn't reached by applyChallenges(POKEMON_ADD_TO_PARTY) above.
    if (addStatus.value && !communitySpeciesAllowed(pokemon.species.getRootSpeciesId(true))) {
      addStatus.value = false;
    }

    globalScene.ui.showText(
      i18next.t(addStatus.value ? "battle:pokemonCaught" : "battle:pokemonCaughtButChallenge", {
        pokemonName: pokemon.name,
      }),
      null,
      () => {
        const end = () => {
          // Co-op (#633, authoritative wave-advance handshake): the host caught the wild enemy,
          // which clears the wave. Signal the guest renderer so it runs the same post-battle tail
          // (it removes the captured enemy without a FaintPhase, so it never queues that tail
          // itself). Hard no-op for solo / non-host / lockstep; guarded against a double-advance.
          //
          // Co-op (#689 capture animation): ALSO carry a tiny cosmetic presentation so the guest
          // plays the ball-throw animation + a locally-localized "X was caught!" line (it never
          // runs this host-only phase, which owns that presentation). Gate it on the SAME
          // `addStatus.value` (mon actually KEPT / added to party) that distinguishes a real catch
          // from a challenge-blocked one - a challenge-blocked catch shows the host
          // `pokemonCaughtButChallenge` and must NOT show the guest a "caught!" line.
          const capturePresentation = addStatus.value
            ? {
                pokeballType: this.pokeballType,
                targetBattlerIndex: this.battlerIndex,
                speciesId: pokemon.species.getRootSpeciesId(true),
              }
            : undefined;
          broadcastCoopWaveResolved("capture", capturePresentation);
          globalScene.phaseManager.unshiftNew("VictoryPhase", this.battlerIndex);
          globalScene.pokemonInfoContainer.hide();
          this.removePb();
          this.end();
        };
        const removePokemon = () => {
          globalScene.addFaintedEnemyScore(pokemon);
          pokemon.hp = 0;
          pokemon.doSetStatus(StatusEffect.FAINT);
          globalScene.clearEnemyHeldItemModifiers();
          pokemon.leaveField(true, true, true);
        };
        const addToParty = (slotIndex?: number) => {
          const newPokemon = pokemon.addToParty(this.pokeballType, slotIndex);
          const modifiers = globalScene.findModifiers(m => m instanceof PokemonHeldItemModifier, false);
          if (globalScene.getPlayerParty().filter(p => p.isShiny()).length === PLAYER_PARTY_MAX_SIZE) {
            globalScene.validateAchv(achvs.SHINY_PARTY);
          }
          Promise.all(modifiers.map(m => globalScene.addModifier(m, true))).then(() => {
            globalScene.updateModifiers(true);
            removePokemon();
            if (newPokemon) {
              newPokemon.leaveField(true, true, false);
              newPokemon.loadAssets().then(end);
            } else {
              end();
            }
          });
        };
        Promise.all([
          pokemon.hideInfo(),
          // #807 B: the local player's OWN catch is an allowlisted account write.
          coopAllowAccountWrite("own-catch", () => globalScene.gameData.setPokemonCaught(pokemon)),
        ]).then(() => {
          if (!addStatus.value) {
            removePokemon();
            end();
            return;
          }
          // Co-op (#633, P1g): the catcher's HALF being full counts as "full" so
          // the release/replace prompt fires at 3 (their cap), not 6. With no half
          // having room, coopAttributeNewMon returns null. Solo modes use the 6-cap.
          const party = globalScene.getPlayerParty();
          const partyFull = globalScene.gameMode.isCoop
            ? coopAttributeNewMon(party) === null
            : party.length === PLAYER_PARTY_MAX_SIZE;
          // Co-op (#856): on a full merged party the keep/release picker belongs to the CATCHER (the ball
          // thrower), not the sole-engine host. A HOST-thrown catch drives the local picker below (the host
          // IS the catcher). A GUEST-thrown catch must NOT let the host decide releases from the MERGED
          // party (that can release the host's OWN mons + mis-attribute the guest's catch - the #800 class):
          // the RECIPIENT (the guest) drives a non-mutating picker on its own client and relays the chosen
          // slot, and the host applies the authoritative release+add here. The caught mon then materializes
          // on the guest via the normal capture handshake (applyCoopCaptureParty). This is the wild-path
          // twin of the #855 ME catch-full sub-prompt, via the CoopGuestRevivalPhase live-battle precedent.
          if (
            partyFull
            && globalScene.gameMode.isCoop
            && this.throwerRole === "guest"
            && getCoopController()?.role === "host"
            && getCoopInteractionRelay() != null
          ) {
            void coopHostAwaitWildCatchFullSlot(pokemon.getNameToRender(), pokemon.species.getRootSpeciesId(true)).then(
              slot => {
                const releaseParty = globalScene.getPlayerParty();
                if (slot != null && slot >= 0 && slot < releaseParty.length) {
                  // The catcher picked a slot to REPLACE. Free it exactly as PartyUiHandler.doRelease does
                  // (strip its held-item modifiers, splice it out, record the release achievement, destroy),
                  // then addToParty into the now-freed slot - the freed half lets coopAttributeNewMon
                  // attribute the caught mon. This is the solo RELEASE flow's release-then-add, driven by
                  // the relayed slot instead of the host's (undrivable-for-a-guest-catch) local UI.
                  void globalScene.removePartyMemberModifiers(slot);
                  const released = releaseParty.splice(slot, 1)[0];
                  erRecordAchievementRelease(released.species.speciesId);
                  released.destroy();
                  addToParty(slot);
                } else {
                  // The catcher cancelled / timed out / disconnected: the caught mon is NOT kept.
                  removePokemon();
                  end();
                }
              },
            );
            return;
          }
          if (partyFull) {
            const promptRelease = () => {
              globalScene.ui.showText(
                i18next.t("battle:partyFull", {
                  pokemonName: pokemon.getNameToRender(),
                }),
                null,
                () => {
                  globalScene.pokemonInfoContainer.makeRoomForConfirmUi(1, true);
                  globalScene.ui.setMode(
                    UiMode.CONFIRM,
                    () => {
                      const newPokemon = globalScene.addPlayerPokemon(
                        pokemon.species,
                        pokemon.level,
                        pokemon.abilityIndex,
                        pokemon.formIndex,
                        pokemon.gender,
                        pokemon.shiny,
                        pokemon.variant,
                        pokemon.ivs,
                        pokemon.nature,
                        pokemon,
                      );
                      globalScene.ui.setMode(
                        UiMode.SUMMARY,
                        newPokemon,
                        0,
                        SummaryUiMode.DEFAULT,
                        () => {
                          globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                            promptRelease();
                          });
                        },
                        false,
                      );
                    },
                    () => {
                      const attributes = {
                        shiny: pokemon.shiny,
                        variant: pokemon.variant,
                        form: pokemon.formIndex,
                        female: pokemon.gender === Gender.FEMALE,
                      };
                      globalScene.ui.setOverlayMode(
                        UiMode.POKEDEX_PAGE,
                        pokemon.species,
                        attributes,
                        null,
                        null,
                        () => {
                          globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                            promptRelease();
                          });
                        },
                      );
                    },
                    () => {
                      globalScene.ui.setMode(
                        UiMode.PARTY,
                        PartyUiMode.RELEASE,
                        this.fieldIndex,
                        (slotIndex: number, _option: PartyOption) => {
                          globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                            if (slotIndex < 6) {
                              addToParty(slotIndex);
                            } else {
                              promptRelease();
                            }
                          });
                        },
                      );
                    },
                    () => {
                      globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                        removePokemon();
                        end();
                      });
                    },
                    "fullParty",
                  );
                },
              );
            };
            promptRelease();
          } else {
            addToParty();
          }
        });
      },
      0,
      true,
    );
  }

  removePb() {
    globalScene.tweens.add({
      targets: this.pokeball,
      duration: 250,
      delay: 250,
      ease: "Sine.easeIn",
      alpha: 0,
      onComplete: () => this.pokeball.destroy(),
    });
  }
}
