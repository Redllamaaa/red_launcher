import { appDataDir } from "@tauri-apps/api/path";
import { LoggerUtil } from "./scripts/loggerutil.js";
const logger = LoggerUtil.getLogger("ConfigManager");

import {
  exists,
  mkdir,
  writeTextFile,
  readTextFile,
  rename,
} from "@tauri-apps/plugin-fs";

const launcherDir = await appDataDir();

function pathJoin(...parts) {
  return parts.join("/").replace(/\/+/g, "/");
}

/**
 * Retrieve the absolute path of the launcher directory.
 *
 * @returns {string} The absolute path of the launcher directory.
 */
export function getLauncherDirectory() {
  return launcherDir;
}

/**
 * Get the launcher's data directory. This is where all files related
 * to game launch are installed (common, instances, java, etc).
 *
 * @returns {string} The absolute path of the launcher's data directory.
 */
export function getDataDirectory(def = false) {
  return !def
    ? config.settings.launcher.dataDirectory
    : DEFAULT_CONFIG.settings.launcher.dataDirectory;
}

/**
 * Set the new data directory.
 *
 * @param {string} dataDirectory The new data directory.
 */
export function setDataDirectory(dataDirectory) {
  config.settings.launcher.dataDirectory = dataDirectory;
}

const configPath = pathJoin(getLauncherDirectory(), "config.json");
const firstLaunch = !(await exists(configPath));

export function getAbsoluteMinRAM(ram, totalMem) {
  if (ram?.minimum != null) {
    return ram.minimum / 1024;
  } else {
    // Legacy behavior
    return totalMem >= 6 * 1073741824 ? 3 : 2;
  }
}

export function getAbsoluteMaxRAM(_ram, totalMem) {
  const gT16 = totalMem - 16 * 1073741824;
  return Math.floor(
    (totalMem -
      (gT16 > 0
        ? Number.parseInt(gT16 / 8) + (16 * 1073741824) / 4
        : totalMem / 4)) /
      1073741824,
  );
}

function resolveSelectedRAM(ram, totalMem) {
  if (ram?.recommended != null) {
    return `${ram.recommended}M`;
  } else {
    return totalMem >= 8 * 1073741824
      ? "4G"
      : totalMem >= 6 * 1073741824
        ? "3G"
        : "2G";
  }
}

/**
 * Three types of values:
 * Static = Explicitly declared.
 * Dynamic = Calculated by a private function.
 * Resolved = Resolved externally, defaults to null.
 */
const DEFAULT_CONFIG = {
  settings: {
    game: {
      resWidth: 1280,
      resHeight: 720,
      fullscreen: false,
      autoConnect: true,
      CloseOnLaunch: false,
      launchDetached: true,
    },
    launcher: {
      allowPrerelease: false,
      dataDirectory: launcherDir,
    },
  },
  clientToken: null,
  selectedServer: null, // Resolved
  selectedAccount: null,
  authenticationDatabase: {},
  modConfigurations: [],
  javaConfig: {},
};

let config = null;

// Persistance Utility Functions

/**
 * Save the current configuration to a file.
 */
export async function save() {
  await writeTextFile(configPath, JSON.stringify(config, null, 4));
}

/**
 * Load the configuration into memory. If a configuration file exists,
 * that will be read and saved. Otherwise, a default configuration will
 * be generated. Note that "resolved" values default to null and will
 * need to be externally assigned.
 */
export async function load() {
  let doLoad = true;

  if (!(await exists(configPath))) {
    await mkdir(getLauncherDirectory(), { recursive: true });

    doLoad = false;
    config = DEFAULT_CONFIG;
    await save();
  }

  if (doLoad) {
    let doValidate = false;
    try {
      const text = await readTextFile(configPath);
      config = JSON.parse(text);
      doValidate = true;
    } catch (err) {
      logger.error(err);
      logger.info("Configuration file contains malformed JSON or is corrupt.");
      logger.info("Generating a new configuration file.");
      await mkdir(getLauncherDirectory(), { recursive: true });
      config = DEFAULT_CONFIG;
      await save();
    }
    if (doValidate) {
      config = validateKeySet(DEFAULT_CONFIG, config);
      await save();
    }
  }
  logger.info("Successfully Loaded");
}

/**
 * @returns {boolean} Whether or not the manager has been loaded.
 */
export function isLoaded() {
  return config != null;
}

/**
 * Validate that the destination object has at least every field
 * present in the source object. Assign a default value otherwise.
 *
 * @param {Object} srcObj The source object to reference against.
 * @param {Object} destObj The destination object.
 * @returns {Object} A validated destination object.
 */
function validateKeySet(srcObj, destObj) {
  if (srcObj == null) {
    srcObj = {};
  }
  const validationBlacklist = ["authenticationDatabase", "javaConfig"];
  const keys = Object.keys(srcObj);
  for (let i = 0; i < keys.length; i++) {
    if (typeof destObj[keys[i]] === "undefined") {
      destObj[keys[i]] = srcObj[keys[i]];
    } else if (
      typeof srcObj[keys[i]] === "object" &&
      srcObj[keys[i]] != null &&
      !(srcObj[keys[i]] instanceof Array) &&
      validationBlacklist.indexOf(keys[i]) === -1
    ) {
      destObj[keys[i]] = validateKeySet(srcObj[keys[i]], destObj[keys[i]]);
    }
  }
  return destObj;
}

/**
 * Check to see if this is the first time the user has launched the
 * application. This is determined by the existance of the data path.
 *
 * @returns {boolean} True if this is the first launch, otherwise false.
 */
export function isFirstLaunch() {
  return firstLaunch;
}

/**
 * Returns the name of the folder in the OS temp directory which we
 * will use to extract and store native dependencies for game launch.
 *
 * @returns {string} The name of the folder.
 */
export function getTempNativeFolder() {
  return "WCNatives";
}

// System Settings (Unconfigurable on UI)

/**
 * Retrieve the common directory for shared
 * game files (assets, libraries, etc).
 *
 * @returns {string} The launcher's common directory.
 */
export function getCommonDirectory() {
  return pathJoin(getDataDirectory(), "common");
}

/**
 * Retrieve the instance directory for the per
 * server game directories.
 *
 * @returns {string} The launcher's instance directory.
 */
export function getInstanceDirectory() {
  return pathJoin(getDataDirectory(), "instances");
}

/**
 * Retrieve the launcher's Client Token.
 * There is no default client token.
 *
 * @returns {string} The launcher's Client Token.
 */
export function getClientToken() {
  return config.clientToken;
}

/**
 * Set the launcher's Client Token.
 *
 * @param {string} clientToken The launcher's new Client Token.
 */
export function setClientToken(clientToken) {
  config.clientToken = clientToken;
}

/**
 * Retrieve the ID of the selected serverpack.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {string} The ID of the selected serverpack.
 */
export function getSelectedServer(def = false) {
  return !def ? config.selectedServer : DEFAULT_CONFIG.clientToken;
}

/**
 * Set the ID of the selected serverpack.
 *
 * @param {string} serverID The ID of the new selected serverpack.
 */
export function setSelectedServer(serverID) {
  config.selectedServer = serverID;
}

/**
 * Get an array of each account currently authenticated by the launcher.
 *
 * @returns {Array.<Object>} An array of each stored authenticated account.
 */
export function getAuthAccounts() {
  return config.authenticationDatabase;
}

/**
 * Returns the authenticated account with the given uuid. Value may
 * be null.
 *
 * @param {string} uuid The uuid of the authenticated account.
 * @returns {Object} The authenticated account with the given uuid.
 */
export function getAuthAccount(uuid) {
  return config.authenticationDatabase[uuid];
}

/**
 * Adds an authenticated microsoft account to the database to be stored.
 *
 * @param {string} uuid The uuid of the authenticated account.
 * @param {string} accessToken The accessToken of the authenticated account.
 * @param {string} name The in game name of the authenticated account.
 * @param {date} mcExpires The date when the mojang access token expires
 * @param {string} msAccessToken The microsoft access token
 * @param {string} msRefreshToken The microsoft refresh token
 * @param {date} msExpires The date when the microsoft access token expires
 *
 * @returns {Object} The authenticated account object created by this action.
 */
export function addMicrosoftAuthAccount(uuid, name, mcExpires) {
  config.selectedAccount = uuid;
  config.authenticationDatabase[uuid] = {
    type: "microsoft",
    username: name.trim(),
    uuid: uuid.trim(),
    displayName: name.trim(),
    expiresAt: mcExpires,
  };
  return config.authenticationDatabase[uuid];
}

/**
 * Remove an authenticated account from the database. If the account
 * was also the selected account, a new one will be selected. If there
 * are no accounts, the selected account will be null.
 *
 * @param {string} uuid The uuid of the authenticated account.
 *
 * @returns {boolean} True if the account was removed, false if it never existed.
 */
export function removeAuthAccount(uuid) {
  if (config.authenticationDatabase[uuid] != null) {
    delete config.authenticationDatabase[uuid];
    if (config.selectedAccount === uuid) {
      const keys = Object.keys(config.authenticationDatabase);
      if (keys.length > 0) {
        config.selectedAccount = keys[0];
      } else {
        config.selectedAccount = null;
        config.clientToken = null;
      }
    }
    return true;
  }
  return false;
}

/**
 * Get the currently selected authenticated account.
 *
 * @returns {Object} The selected authenticated account.
 */
export function getSelectedAccount() {
  return config.authenticationDatabase[config.selectedAccount];
}

/**
 * Set the selected authenticated account.
 *
 * @param {string} uuid The UUID of the account which is to be set
 * as the selected account.
 *
 * @returns {Object} The selected authenticated account.
 */
export function setSelectedAccount(uuid) {
  const authAcc = config.authenticationDatabase[uuid];
  if (authAcc != null) {
    config.selectedAccount = uuid;
  }
  return authAcc;
}

/**
 * Get an array of each mod configuration currently stored.
 *
 * @returns {Array.<Object>} An array of each stored mod configuration.
 */
export function getModConfigurations() {
  return config.modConfigurations;
}

/**
 * Set the array of stored mod configurations.
 *
 * @param {Array.<Object>} configurations An array of mod configurations.
 */
export function setModConfigurations(configurations) {
  config.modConfigurations = configurations;
}

/**
 * Get the mod configuration for a specific server. If one does not
 * exist, a default configuration will be created, set, and returned.
 *
 * @param {string} serverid The id of the server.
 * @returns {Object} The mod configuration for the given server.
 */
export function getModConfiguration(serverid) {
  const cfgs = config.modConfigurations;
  for (let i = 0; i < cfgs.length; i++) {
    if (cfgs[i].id === serverid) {
      return cfgs[i];
    }
  }
  const defaultCfg = { id: serverid, mods: {} };
  cfgs.push(defaultCfg);
  return defaultCfg;
}

/**
 * Set the mod configuration for a specific server. This overrides any existing value.
 *
 * @param {string} serverid The id of the server for the given mod configuration.
 * @param {Object} configuration The mod configuration for the given server.
 */
export function setModConfiguration(serverid, configuration) {
  const cfgs = config.modConfigurations;
  for (let i = 0; i < cfgs.length; i++) {
    if (cfgs[i].id === serverid) {
      cfgs[i] = configuration;
      return;
    }
  }
  cfgs.push(configuration);
}

// User Configurable Settings

// Java Settings
function defaultJavaConfig(effectiveJavaOptions, ram, totalMem) {
  if (effectiveJavaOptions.suggestedMajor > 17) {
    return defaultJavaConfig25(ram, totalMem);
  } else if (effectiveJavaOptions.suggestedMajor > 8) {
    return defaultJavaConfig17(ram, totalMem);
  } else {
    return defaultJavaConfig8(ram, totalMem);
  }
}

function defaultJavaConfig8(ram, totalMem) {
  return {
    minRAM: resolveSelectedRAM(ram, totalMem),
    maxRAM: resolveSelectedRAM(ram, totalMem),
    executable: null,
    jvmOptions: [
      "-XX:+UseConcMarkSweepGC",
      "-XX:+CMSIncrementalMode",
      "-XX:-UseAdaptiveSizePolicy",
      "-Xmn128M",
    ],
  };
}

function defaultJavaConfig17(ram, totalMem) {
  return {
    minRAM: resolveSelectedRAM(ram, totalMem),
    maxRAM: resolveSelectedRAM(ram, totalMem),
    executable: null,
    jvmOptions: [
      "-XX:+UnlockExperimentalVMOptions",
      "-XX:+UseG1GC",
      "-XX:G1NewSizePercent=20",
      "-XX:G1ReservePercent=20",
      "-XX:MaxGCPauseMillis=50",
      "-XX:G1HeapRegionSize=32M",
    ],
  };
}

function defaultJavaConfig25(ram, totalMem) {
  return {
    minRAM: resolveSelectedRAM(ram, totalMem),
    maxRAM: resolveSelectedRAM(ram, totalMem),
    executable: null,
    jvmOptions: [
      "-XX:+UseCompactObjectHeaders",
      "-XX:+AlwaysPreTouch",
      "-XX:+UseStringDeduplication",
      "-XX:+UseZGC",
    ],
  };
}

/**
 * Ensure a java config property is set for the given server.
 *
 * @param {string} serverid The server id.
 * @param {*} mcVersion The minecraft version of the server.
 */
export function ensureJavaConfig(
  serverid,
  effectiveJavaOptions,
  ram,
  totalMem,
) {
  if (!Object.prototype.hasOwnProperty.call(config.javaConfig, serverid)) {
    config.javaConfig[serverid] = defaultJavaConfig(
      effectiveJavaOptions,
      ram,
      totalMem,
    );
  }
}

/**
 * Retrieve the minimum amount of memory for JVM initialization. This value
 * contains the units of memory. For example, '5G' = 5 GigaBytes, '1024M' =
 * 1024 MegaBytes, etc.
 *
 * @param {string} serverid The server id.
 * @returns {string} The minimum amount of memory for JVM initialization.
 */
export function getMinRAM(serverid) {
  return config.javaConfig[serverid]?.minRAM ?? "1G";
}

/**
 * Set the minimum amount of memory for JVM initialization. This value should
 * contain the units of memory. For example, '5G' = 5 GigaBytes, '1024M' =
 * 1024 MegaBytes, etc.
 *
 * @param {string} serverid The server id.
 * @param {string} minRAM The new minimum amount of memory for JVM initialization.
 */
export function setMinRAM(serverid, minRAM) {
  if (!config.javaConfig[serverid]) {
    config.javaConfig[serverid] = {};
  }
  config.javaConfig[serverid].minRAM = minRAM;
}

/**
 * Retrieve the maximum amount of memory for JVM initialization. This value
 * contains the units of memory. For example, '5G' = 5 GigaBytes, '1024M' =
 * 1024 MegaBytes, etc.
 *
 * @param {string} serverid The server id.
 * @returns {string} The maximum amount of memory for JVM initialization.
 */
export function getMaxRAM(serverid) {
  return config.javaConfig[serverid]?.maxRAM ?? "2G";
}

/**
 * Set the maximum amount of memory for JVM initialization. This value should
 * contain the units of memory. For example, '5G' = 5 GigaBytes, '1024M' =
 * 1024 MegaBytes, etc.
 *
 * @param {string} serverid The server id.
 * @param {string} maxRAM The new maximum amount of memory for JVM initialization.
 */
export function setMaxRAM(serverid, maxRAM) {
  if (!config.javaConfig[serverid]) {
    config.javaConfig[serverid] = {};
  }
  config.javaConfig[serverid].maxRAM = maxRAM;
}

/**
 * Retrieve the path of the Java Executable.
 *
 * This is a resolved configuration value and defaults to null until externally assigned.
 *
 * @param {string} serverid The server id.
 * @returns {string} The path of the Java Executable.
 */
export function getJavaExecutable(serverid) {
  return config.javaConfig[serverid]?.executable ?? null;
}

/**
 * Set the path of the Java Executable.
 *
 * @param {string} serverid The server id.
 * @param {string} executable The new path of the Java Executable.
 */
export function setJavaExecutable(serverid, executable) {
  if (!config.javaConfig[serverid]) {
    config.javaConfig[serverid] = {};
  }
  config.javaConfig[serverid].executable = executable;
}

/**
 * Retrieve the additional arguments for JVM initialization. Required arguments,
 * such as memory allocation, will be dynamically resolved and will not be included
 * in this value.
 *
 * @param {string} serverid The server id.
 * @returns {Array.<string>} An array of the additional arguments for JVM initialization.
 */
export function getJVMOptions(serverid) {
  return config.javaConfig[serverid]?.jvmOptions ?? [];
}

/**
 * Set the additional arguments for JVM initialization. Required arguments,
 * such as memory allocation, will be dynamically resolved and should not be
 * included in this value.
 *
 * @param {string} serverid The server id.
 * @param {Array.<string>} jvmOptions An array of the new additional arguments for JVM
 * initialization.
 */
export function setJVMOptions(serverid, jvmOptions) {
  if (!config.javaConfig[serverid]) {
    config.javaConfig[serverid] = {};
  }
  config.javaConfig[serverid].jvmOptions = jvmOptions;
}

// Game Settings

/**
 * Retrieve the width of the game window.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {number} The width of the game window.
 */
export function getGameWidth(def = false) {
  return !def
    ? config.settings.game.resWidth
    : DEFAULT_CONFIG.settings.game.resWidth;
}

/**
 * Set the width of the game window.
 *
 * @param {number} resWidth The new width of the game window.
 */
export function setGameWidth(resWidth) {
  config.settings.game.resWidth = Number.parseInt(resWidth);
}

/**
 * Validate a potential new width value.
 *
 * @param {number} resWidth The width value to validate.
 * @returns {boolean} Whether or not the value is valid.
 */
export function validateGameWidth(resWidth) {
  const nVal = Number.parseInt(resWidth);
  return Number.isInteger(nVal) && nVal >= 0;
}

/**
 * Retrieve the height of the game window.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {number} The height of the game window.
 */
export function getGameHeight(def = false) {
  return !def
    ? config.settings.game.resHeight
    : DEFAULT_CONFIG.settings.game.resHeight;
}

/**
 * Set the height of the game window.
 *
 * @param {number} resHeight The new height of the game window.
 */
export function setGameHeight(resHeight) {
  config.settings.game.resHeight = Number.parseInt(resHeight);
}

/**
 * Validate a potential new height value.
 *
 * @param {number} resHeight The height value to validate.
 * @returns {boolean} Whether or not the value is valid.
 */
export function validateGameHeight(resHeight) {
  const nVal = Number.parseInt(resHeight);
  return Number.isInteger(nVal) && nVal >= 0;
}

/**
 * Check if the game should be launched in fullscreen mode.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {boolean} Whether or not the game is set to launch in fullscreen mode.
 */
export function getFullscreen(def = false) {
  return !def
    ? config.settings.game.fullscreen
    : DEFAULT_CONFIG.settings.game.fullscreen;
}

/**
 * Change the status of if the game should be launched in fullscreen mode.
 *
 * @param {boolean} fullscreen Whether or not the game should launch in fullscreen mode.
 */
export function setFullscreen(fullscreen) {
  config.settings.game.fullscreen = fullscreen;
}

/**
 * Check if the launcher should be closed when the game launch.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {boolean} Whether or not the launcher should be closed when the game launched.
 */
export function getCloseOnLaunch(def = false) {
  return !def
    ? config.settings.game.CloseOnLaunch
    : DEFAULT_CONFIG.settings.game.CloseOnLaunch;
}

/**
 * Change the status if the launcher should be closed when the game launch.
 *
 * @param {boolean} CloseOnLaunch Whether or not the launcher should be closed when the game launched.
 */
export function setCloseOnLaunch(CloseOnLaunch) {
  config.settings.game.CloseOnLaunch = CloseOnLaunch;
}

/**
 * Check if the game should auto connect to servers.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {boolean} Whether or not the game should auto connect to servers.
 */
export function getAutoConnect(def = false) {
  return !def
    ? config.settings.game.autoConnect
    : DEFAULT_CONFIG.settings.game.autoConnect;
}

/**
 * Change the status of whether or not the game should auto connect to servers.
 *
 * @param {boolean} autoConnect Whether or not the game should auto connect to servers.
 */
export function setAutoConnect(autoConnect) {
  config.settings.game.autoConnect = autoConnect;
}

/**
 * Check if the game should launch as a detached process.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {boolean} Whether or not the game will launch as a detached process.
 */
export function getLaunchDetached(def = false) {
  return !def
    ? config.settings.game.launchDetached
    : DEFAULT_CONFIG.settings.game.launchDetached;
}

/**
 * Change the status of whether or not the game should launch as a detached process.
 *
 * @param {boolean} launchDetached Whether or not the game should launch as a detached process.
 */
export function setLaunchDetached(launchDetached) {
  config.settings.game.launchDetached = launchDetached;
}

// Launcher Settings

/**
 * Check if the launcher should download prerelease versions.
 *
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {boolean} Whether or not the launcher should download prerelease versions.
 */
export function getAllowPrerelease(def = false) {
  return !def
    ? config.settings.launcher.allowPrerelease
    : DEFAULT_CONFIG.settings.launcher.allowPrerelease;
}

/**
 * Change the status of Whether or not the launcher should download prerelease versions.
 *
 * @param {boolean} launchDetached Whether or not the launcher should download prerelease versions.
 */
export function setAllowPrerelease(allowPrerelease) {
  config.settings.launcher.allowPrerelease = allowPrerelease;
}
