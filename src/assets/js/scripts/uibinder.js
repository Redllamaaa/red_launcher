/**
 * Initialize UI functions which depend on internal modules.
 * Loaded after core UI functions are initialized in uicore.js.
 */
// Tauri
import { ready } from "./bootstrap.js";

import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentView, setCurrentView, switchView } from "./viewstate.js";

// Requirements
import * as ConfigManager from "../configmanager.js";
import Lang from "../langloader.js";
import $ from "jquery";
import isDev from "../isdev.js";
import { loggerAutoUpdater } from "./uicore.js";
import { prepareSettings } from "./settings.js";
import {
  setOverlayContent,
  setOverlayHandler,
  toggleOverlay,
  setDismissHandler,
  toggleAccountSelection,
} from "./overlay.js";
import { DistroAPI } from "../distromanager.js";
import { callUpdateSelectedServer } from "./serverStateHooks.js";
import { refreshServerStatus, updateSelectedAccount } from "./landing.js";
import { loginOptionsCancelEnabled } from "./loginOptions.js";
import {
  setLoginOptionsViewOnLoginSuccess,
  setLoginOptionsViewOnLoginCancel,
  setLoginOptionsViewOnCancel,
  setLoginOptionsViewCancelHandler,
} from "./loginOptionsState.js";
import { Type } from "helios-distribution-types";
import * as AuthManager from "../authmanager.js";
import { LoggerUtil } from "./loggerutil.js";

await ready();

const loggerUiBinder = LoggerUtil.getLogger("UIBinder");
let rscShouldLoad = false;
let fatalStartupError = false;

import { VIEWS } from "./views.js";

async function showMainUI(data) {
  if (!isDev) {
    loggerAutoUpdater.info("Initializing..");

    // TODO: Replace with Tauri IPC once the Rust command/event exists.
    // ipcRenderer.send(
    //   "autoUpdateAction",
    //   "initAutoUpdater",
    //   ConfigManager.getAllowPrerelease(),
    // );
  }

  await prepareSettings(true);
  callUpdateSelectedServer(
    data.getServerById(ConfigManager.getSelectedServer()),
  );
  refreshServerStatus();
  setTimeout(() => {
    document.body.style.backgroundImage = `url('/images/backgrounds/${document.body.getAttribute("bkid")}.jpg')`;

    $("#main").show();

    const isLoggedIn = Object.keys(ConfigManager.getAuthAccounts()).length > 0;

    if (!isDev && isLoggedIn) {
      validateSelectedAccount();
    }

    if (ConfigManager.isFirstLaunch()) {
      setCurrentView(VIEWS.welcome);
      $(VIEWS.welcome).fadeIn(1000);
    } else {
      if (isLoggedIn) {
        setCurrentView(VIEWS.landing);
        $(VIEWS.landing).fadeIn(1000);
      } else {
        loginOptionsCancelEnabled(false);
        setLoginOptionsViewOnLoginSuccess(VIEWS.landing);
        setLoginOptionsViewOnLoginCancel(VIEWS.loginOptions);
        setCurrentView(VIEWS.loginOptions);
        $(VIEWS.loginOptions).fadeIn(1000);
      }
    }

    setTimeout(() => {
      $("#loadingContainer").fadeOut(500, () => {
        $("#loadSpinnerImage").removeClass("rotating");
      });
    }, 250);
  }, 750);
}

function showFatalStartupError() {
  setTimeout(() => {
    $("#loadingContainer").fadeOut(250, () => {
      document.getElementById("overlayContainer").style.background = "none";
      setOverlayContent(
        Lang.queryJS("uibinder.startup.fatalErrorTitle"),
        Lang.queryJS("uibinder.startup.fatalErrorMessage"),
        Lang.queryJS("uibinder.startup.closeButton"),
      );
      setOverlayHandler(() => {
        const window = remote.getCurrentWindow();
        getCurrentWindow().close();
      });
      toggleOverlay(true);
    });
  }, 750);
}

/**
 * Common functions to perform after refreshing the distro index.
 *
 * @param {Object} data The distro index object.
 */
async function onDistroRefresh(data) {
  callUpdateSelectedServer(
    data.getServerById(ConfigManager.getSelectedServer()),
  );
  refreshServerStatus();
  syncModConfigurations(data);
  await ensureJavaSettings(data);
}

/**
 * Sync the mod configurations with the distro index.
 *
 * @param {Object} data The distro index object.
 */
function syncModConfigurations(data) {
  const syncedCfgs = [];

  for (let serv of data.servers) {
    const id = serv.rawServer.id;
    const mdls = serv.modules;
    const cfg = ConfigManager.getModConfiguration(id);

    if (cfg != null) {
      const modsOld = cfg.mods;
      const mods = {};

      for (let mdl of mdls) {
        const type = mdl.rawModule.type;

        if (
          type === Type.ForgeMod ||
          type === Type.LiteMod ||
          type === Type.LiteLoader ||
          type === Type.FabricMod
        ) {
          if (!mdl.getRequired().value) {
            const mdlID = mdl.getVersionlessMavenIdentifier();
            if (modsOld[mdlID] == null) {
              mods[mdlID] = scanOptionalSubModules(mdl.subModules, mdl);
            } else {
              mods[mdlID] = mergeModConfiguration(
                modsOld[mdlID],
                scanOptionalSubModules(mdl.subModules, mdl),
                false,
              );
            }
          } else {
            if (mdl.subModules.length > 0) {
              const mdlID = mdl.getVersionlessMavenIdentifier();
              const v = scanOptionalSubModules(mdl.subModules, mdl);
              if (typeof v === "object") {
                if (modsOld[mdlID] == null) {
                  mods[mdlID] = v;
                } else {
                  mods[mdlID] = mergeModConfiguration(modsOld[mdlID], v, true);
                }
              }
            }
          }
        }
      }

      syncedCfgs.push({
        id,
        mods,
      });
    } else {
      const mods = {};

      for (let mdl of mdls) {
        const type = mdl.rawModule.type;
        if (
          type === Type.ForgeMod ||
          type === Type.LiteMod ||
          type === Type.LiteLoader ||
          type === Type.FabricMod
        ) {
          if (!mdl.getRequired().value) {
            mods[mdl.getVersionlessMavenIdentifier()] = scanOptionalSubModules(
              mdl.subModules,
              mdl,
            );
          } else {
            if (mdl.subModules.length > 0) {
              const v = scanOptionalSubModules(mdl.subModules, mdl);
              if (typeof v === "object") {
                mods[mdl.getVersionlessMavenIdentifier()] = v;
              }
            }
          }
        }
      }

      syncedCfgs.push({
        id,
        mods,
      });
    }
  }

  ConfigManager.setModConfigurations(syncedCfgs);
  ConfigManager.save();
}

/**
 * Ensure java configurations are present for the available servers.
 *
 * @param {Object} data The distro index object.
 */
async function ensureJavaSettings(data) {
  for (const serv of data.servers) {
    await ConfigManager.ensureJavaConfig(
      serv.rawServer.id,
      serv.effectiveJavaOptions,
      serv.rawServer.javaOptions?.ram,
    );
  }

  ConfigManager.save();
}

/**
 * Recursively scan for optional sub modules. If none are found,
 * this function returns a boolean. If optional sub modules do exist,
 * a recursive configuration object is returned.
 *
 * @returns {boolean | Object} The resolved mod configuration.
 */
function scanOptionalSubModules(mdls, origin) {
  if (mdls != null) {
    const mods = {};

    for (let mdl of mdls) {
      const type = mdl.rawModule.type;
      // Optional types.
      if (
        type === Type.ForgeMod ||
        type === Type.LiteMod ||
        type === Type.LiteLoader ||
        type === Type.FabricMod
      ) {
        // It is optional.
        if (!mdl.getRequired().value) {
          mods[mdl.getVersionlessMavenIdentifier()] = scanOptionalSubModules(
            mdl.subModules,
            mdl,
          );
        } else {
          if (mdl.hasSubModules()) {
            const v = scanOptionalSubModules(mdl.subModules, mdl);
            if (typeof v === "object") {
              mods[mdl.getVersionlessMavenIdentifier()] = v;
            }
          }
        }
      }
    }

    if (Object.keys(mods).length > 0) {
      const ret = {
        mods,
      };
      if (!origin.getRequired().value) {
        ret.value = origin.getRequired().def;
      }
      return ret;
    }
  }
  return origin.getRequired().def;
}

/**
 * Recursively merge an old configuration into a new configuration.
 *
 * @param {boolean | Object} o The old configuration value.
 * @param {boolean | Object} n The new configuration value.
 * @param {boolean} nReq If the new value is a required mod.
 *
 * @returns {boolean | Object} The merged configuration.
 */
function mergeModConfiguration(o, n, nReq = false) {
  if (typeof o === "boolean") {
    if (typeof n === "boolean") return o;
    else if (typeof n === "object") {
      if (!nReq) {
        n.value = o;
      }
      return n;
    }
  } else if (typeof o === "object") {
    if (typeof n === "boolean")
      return typeof o.value !== "undefined" ? o.value : true;
    else if (typeof n === "object") {
      if (!nReq) {
        n.value = typeof o.value !== "undefined" ? o.value : true;
      }

      const newMods = Object.keys(n.mods);
      for (let i = 0; i < newMods.length; i++) {
        const mod = newMods[i];
        if (o.mods[mod] != null) {
          n.mods[mod] = mergeModConfiguration(o.mods[mod], n.mods[mod]);
        }
      }

      return n;
    }
  }
  // If for some reason we haven't been able to merge,
  // wipe the old value and use the new one. Just to be safe
  return n;
}

export async function validateSelectedAccount() {
  const selectedAcc = ConfigManager.getSelectedAccount();
  if (selectedAcc != null) {
    const val = await AuthManager.validateSelected();
    if (!val) {
      ConfigManager.removeAuthAccount(selectedAcc.uuid);
      ConfigManager.save();
      const accLen = Object.keys(ConfigManager.getAuthAccounts()).length;
      setOverlayContent(
        Lang.queryJS("uibinder.validateAccount.failedMessageTitle"),
        accLen > 0
          ? Lang.queryJS("uibinder.validateAccount.failedMessage", {
              account: selectedAcc.displayName,
            })
          : Lang.queryJS(
              "uibinder.validateAccount.failedMessageSelectAnotherAccount",
              { account: selectedAcc.displayName },
            ),
        Lang.queryJS("uibinder.validateAccount.loginButton"),
        Lang.queryJS("uibinder.validateAccount.selectAnotherAccountButton"),
      );
      setOverlayHandler(() => {
        setLoginOptionsViewOnLoginSuccess(getCurrentView());
        setLoginOptionsViewOnLoginCancel(VIEWS.loginOptions);

        if (accLen > 0) {
          setLoginOptionsViewOnCancel(getCurrentView());
          setLoginOptionsViewCancelHandler(() => {
            ConfigManager.addMicrosoftAuthAccount(
              selectedAcc.uuid,
              selectedAcc.accessToken,
              selectedAcc.username,
              selectedAcc.expiresAt,
              selectedAcc.microsoft.access_token,
              selectedAcc.microsoft.refresh_token,
              selectedAcc.microsoft.expires_at,
            );
            ConfigManager.save();
            validateSelectedAccount();
          });
          loginOptionsCancelEnabled(true);
        } else {
          loginOptionsCancelEnabled(false);
        }
        toggleOverlay(false);
        switchView(getCurrentView(), VIEWS.loginOptions);
      });
      setDismissHandler(async () => {
        if (accLen > 1) {
          await prepareAccountSelectionList();
          $("#overlayContent").fadeOut(250, () => {
            bindOverlayKeys(true, "accountSelectContent", true);
            $("#accountSelectContent").fadeIn(250);
          });
        } else {
          const accountsObj = ConfigManager.getAuthAccounts();
          const accounts = Array.from(
            Object.keys(accountsObj),
            (v) => accountsObj[v],
          );
          // This function validates the account switch.
          setSelectedAccount(accounts[0].uuid);
          toggleOverlay(false);
        }
      });
      toggleOverlay(true, accLen > 0);
    } else {
      return true;
    }
  } else {
    return true;
  }
}

/**
 * Temporary function to update the selected account along
 * with the relevent UI elements.
 *
 * @param {string} uuid The UUID of the account.
 */
function setSelectedAccount(uuid) {
  const authAcc = ConfigManager.setSelectedAccount(uuid);
  ConfigManager.save();
  updateSelectedAccount(authAcc);
  validateSelectedAccount();
}

// Synchronous Listener
document.addEventListener(
  "readystatechange",
  async () => {
    if (
      document.readyState === "interactive" ||
      document.readyState === "complete"
    ) {
      if (rscShouldLoad) {
        rscShouldLoad = false;
        if (!fatalStartupError) {
          const data = await DistroAPI.getDistribution();
          await showMainUI(data);
        } else {
          showFatalStartupError();
        }
      }
    }
  },
  false,
);

// TODO: Directly fetch and initialize the distribution, since Electron's IPC-based
// "distributionIndexDone" event has no equivalent yet — this replaces it
// until DistroAPI is properly ported and can emit its own readiness signal.
(async () => {
  try {
    const data = await DistroAPI.getDistribution();
    syncModConfigurations(data);
    await ensureJavaSettings(data);
    if (
      document.readyState === "interactive" ||
      document.readyState === "complete"
    ) {
      await showMainUI(data);
    } else {
      rscShouldLoad = true;
    }
  } catch (err) {
    loggerUiBinder.error("STARTUP ERROR:", err);
    loggerUiBinder.error("STACK:", err?.stack);
    fatalStartupError = true;
    if (
      document.readyState === "interactive" ||
      document.readyState === "complete"
    ) {
      showFatalStartupError();
    } else {
      rscShouldLoad = true;
    }
  }
})();

// Util for development
async function devModeToggle() {
  DistroAPI.toggleDevMode(true);
  const data = await DistroAPI.refreshDistributionOrFallback();
  await ensureJavaSettings(data);
  callUpdateSelectedServer(data.servers[0]);
  syncModConfigurations(data);
}

export { VIEWS, getCurrentView, switchView };
