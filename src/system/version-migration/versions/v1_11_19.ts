import { globalScene } from "#app/global-scene";
import { SettingKeys } from "#system/settings";
import type { SettingsSaveMigrator } from "#types/save-migrators";

/**
 * Migrate old values of {@linkcode SettingKeys.Game_Speed} property to reworked indexes
 * @param data - The `settings` object
 */
const fixGameSpeed: SettingsSaveMigrator = {
  version: "1.11.19",
  // biome-ignore lint/complexity/noBannedTypes: TODO - refactor settings
  migrate: (data: Object): void => {
    if (Object.hasOwn(data, SettingKeys.Game_Speed)) {
      const savedValue = data[SettingKeys.Game_Speed];
      let newValue = 1;
      if (savedValue <= 3) {
        newValue = 0;
        globalScene.gameSpeed = 2;
      } else if (savedValue <= 5) {
        newValue = 1;
        globalScene.gameSpeed = 3;
      } else if (savedValue <= 6) {
        newValue = 2;
        globalScene.gameSpeed = 4;
      } else if (savedValue <= 7) {
        newValue = 3;
        globalScene.gameSpeed = 5;
      }
      data[SettingKeys.Game_Speed] = newValue;
      // ER (#430): stamp the version BEFORE persisting. Without this the
      // migration re-ran on EVERY game load (settings only get a gameVersion
      // stamp when the player changes a setting), re-clamping whatever speed
      // the player had just picked - "my settings keep getting overwritten".
      data["gameVersion"] = "1.11.19";
      localStorage.setItem("settings", JSON.stringify(data));
    }
  },
};

export const settingsMigrators: readonly SettingsSaveMigrator[] = [fixGameSpeed] as const;
