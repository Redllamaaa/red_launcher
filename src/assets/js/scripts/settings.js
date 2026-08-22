import { ready } from "./bootstrap.js";

import { open } from "@tauri-apps/plugin-dialog";
import { fetch } from "@tauri-apps/plugin-http";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { platform } from "@tauri-apps/plugin-os";
import Lang from "../langloader.js";
import { LoggerUtil } from "./loggerutil.js";
import * as ConfigManager from "../configmanager.js";
import * as AuthManager from "../authmanager.js";
import { DistroAPI } from "../distromanager.js";
import { updateSelectedAccount } from "./landing.js";
import { validateSelectedAccount } from "./uibinder.js";
import { getMemoryInfo, getCachedMemoryInfo } from "./sysinfo.js";

// Requirements
import { getCurrentView, switchView } from "./viewstate.js";
import {
  setOverlayContent,
  setOverlayHandler,
  toggleOverlay,
  setDismissHandler,
  toggleAccountSelection,
  toggleServerSelection,
} from "./overlay.js";
import { VIEWS } from "./views.js";
import semver from "semver";
import $ from "jquery";

import { validateSelectedJvm, ensureJavaDirIsRoot } from "../javaguard.js";
import {
  setLoginOptionsViewOnLoginSuccess,
  setLoginOptionsViewOnLoginCancel,
} from "./loginOptionsState.js";
import { loginOptionsCancelEnabled } from "./loginOptions.js";

await ready();

// TODO: port to Rust — real filesystem scanning of mods/shaderpacks dirs
const DropinModUtil = {
  validateDir: () => false,
  scanForDropinMods: () => [],
  addDropinMods: async () => {},
  deleteDropinMod: async () => {},
  toggleDropinMod: () => {},
  isDropinModEnabled: () => false,
  scanForShaderpacks: () => [],
  getEnabledShaderpack: () => null,
  setEnabledShaderpack: () => {},
  addShaderpacks: async () => {},
};

import { open as openPath } from "@tauri-apps/plugin-shell";

const settingsState = {
  invalid: new Set(),
};

function bindSettingsSelect() {
  for (let ele of document.getElementsByClassName("settingsSelectContainer")) {
    const selectedDiv = ele.getElementsByClassName("settingsSelectSelected")[0];

    selectedDiv.onclick = (e) => {
      e.stopPropagation();
      closeSettingsSelect(e.target);
      e.target.nextElementSibling.toggleAttribute("hidden");
      e.target.classList.toggle("select-arrow-active");
    };
  }
}

function closeSettingsSelect(el) {
  for (let ele of document.getElementsByClassName("settingsSelectContainer")) {
    const selectedDiv = ele.getElementsByClassName("settingsSelectSelected")[0];
    const optionsDiv = ele.getElementsByClassName("settingsSelectOptions")[0];

    if (!(selectedDiv === el)) {
      selectedDiv.classList.remove("select-arrow-active");
      optionsDiv.setAttribute("hidden", "");
    }
  }
}

/* If the user clicks anywhere outside the select box,
then close all select boxes: */
document.addEventListener("click", closeSettingsSelect);

bindSettingsSelect();

function bindFileSelectors() {
  for (let ele of document.getElementsByClassName("settingsFileSelButton")) {
    ele.onclick = async (e) => {
      const isJavaExecSel = ele.id === "settingsJavaExecSel";
      const directoryDialog =
        ele.hasAttribute("dialogDirectory") &&
        ele.getAttribute("dialogDirectory") == "true";

      const dialogOptions = {
        directory: directoryDialog,
        multiple: false,
      };

      if (ele.hasAttribute("dialogTitle")) {
        dialogOptions.title = ele.getAttribute("dialogTitle");
      }

      if (isJavaExecSel && platform() === "windows") {
        dialogOptions.filters = [
          {
            name: Lang.queryJS("settings.fileSelectors.executables"),
            extensions: ["exe"],
          },
          {
            name: Lang.queryJS("settings.fileSelectors.allFiles"),
            extensions: ["*"],
          },
        ];
      }

      const selected = await open(dialogOptions);

      if (selected !== null) {
        ele.previousElementSibling.value = selected;
        if (isJavaExecSel) {
          await populateJavaExecDetails(ele.previousElementSibling.value);
        }
      }
    };
  }
}

bindFileSelectors();

/**
 * General Settings Functions
 */

/**
 * Bind value validators to the settings UI elements. These will
 * validate against the criteria defined in the ConfigManager (if
 * any). If the value is invalid, the UI will reflect this and saving
 * will be disabled until the value is corrected. This is an automated
 * process. More complex UI may need to be bound separately.
 */

const closeOnLaunchCheckbox = document.querySelector(
  'input[cValue="CloseOnLaunch"]',
);
const launchDetachedCheckbox = document.querySelector(
  'input[cValue="LaunchDetached"]',
);

closeOnLaunchCheckbox.addEventListener("change", function () {
  if (this.checked) {
    launchDetachedCheckbox.disabled = true;
    launchDetachedCheckbox.checked = true;
  } else {
    launchDetachedCheckbox.disabled = false;
  }
});

function initSettingsValidators() {
  const sEls = document
    .getElementById("settingsContainer")
    .querySelectorAll("[cValue]");
  Array.from(sEls).map((v, index, arr) => {
    const vFn = ConfigManager["validate" + v.getAttribute("cValue")];
    if (typeof vFn === "function") {
      if (v.tagName === "INPUT") {
        if (v.type === "number" || v.type === "text") {
          v.addEventListener("keyup", (e) => {
            const v = e.target;
            if (!vFn(v.value)) {
              settingsState.invalid.add(v.id);
              v.setAttribute("error", "");
              settingsSaveDisabled(true);
            } else {
              if (v.hasAttribute("error")) {
                v.removeAttribute("error");
                settingsState.invalid.delete(v.id);
                if (settingsState.invalid.size === 0) {
                  settingsSaveDisabled(false);
                }
              }
            }
          });
        }
      }
    }
  });
}

/**
 * Load configuration values onto the UI. This is an automated process.
 */
async function initSettingsValues() {
  const sEls = document
    .getElementById("settingsContainer")
    .querySelectorAll("[cValue]");

  for (const v of sEls) {
    const cVal = v.getAttribute("cValue");
    const serverDependent = v.hasAttribute("serverDependent"); // Means the first argument is the server id.
    const gFn = ConfigManager["get" + cVal];
    const gFnOpts = [];
    if (serverDependent) {
      gFnOpts.push(ConfigManager.getSelectedServer());
    }
    if (typeof gFn === "function") {
      if (v.tagName === "INPUT") {
        if (v.type === "number" || v.type === "text") {
          // Special Conditions
          if (cVal === "JavaExecutable") {
            v.value = gFn.apply(null, gFnOpts);
            await populateJavaExecDetails(v.value);
          } else if (cVal === "DataDirectory") {
            v.value = gFn.apply(null, gFnOpts);
          } else if (cVal === "JVMOptions") {
            v.value = gFn.apply(null, gFnOpts).join(" ");
          } else {
            v.value = gFn.apply(null, gFnOpts);
          }
        } else if (v.type === "checkbox") {
          v.checked = gFn.apply(null, gFnOpts);
        }
      } else if (v.tagName === "DIV") {
        if (v.classList.contains("rangeSlider")) {
          // Special Conditions
          if (cVal === "MinRAM" || cVal === "MaxRAM") {
            let val = gFn.apply(null, gFnOpts);
            if (val.endsWith("M")) {
              val = Number(val.substring(0, val.length - 1)) / 1024;
            } else {
              val = Number.parseFloat(val);
            }

            v.setAttribute("value", val);
          } else {
            v.setAttribute(
              "value",
              Number.parseFloat(gFn.apply(null, gFnOpts)),
            );
          }
        }
      }
    }
  }
}

/**
 * Save the settings values.
 */
function saveSettingsValues() {
  const sEls = document
    .getElementById("settingsContainer")
    .querySelectorAll("[cValue]");
  Array.from(sEls).map((v, index, arr) => {
    const cVal = v.getAttribute("cValue");
    const serverDependent = v.hasAttribute("serverDependent"); // Means the first argument is the server id.
    const sFn = ConfigManager["set" + cVal];
    const sFnOpts = [];
    if (serverDependent) {
      sFnOpts.push(ConfigManager.getSelectedServer());
    }
    if (typeof sFn === "function") {
      if (v.tagName === "INPUT") {
        if (v.type === "number" || v.type === "text") {
          // Special Conditions
          if (cVal === "JVMOptions") {
            if (!v.value.trim()) {
              sFnOpts.push([]);
              sFn.apply(null, sFnOpts);
            } else {
              sFnOpts.push(v.value.trim().split(/\s+/));
              sFn.apply(null, sFnOpts);
            }
          } else {
            sFnOpts.push(v.value);
            sFn.apply(null, sFnOpts);
          }
        } else if (v.type === "checkbox") {
          sFnOpts.push(v.checked);
          sFn.apply(null, sFnOpts);
          // Special Conditions
          if (cVal === "AllowPrerelease") {
            ConfigManager.setAllowPrerelease(v.checked);
          }
        }
      } else if (v.tagName === "DIV") {
        if (v.classList.contains("rangeSlider")) {
          // Special Conditions
          if (cVal === "MinRAM" || cVal === "MaxRAM") {
            let val = Number(v.getAttribute("value"));
            if (val % 1 > 0) {
              val = val * 1024 + "M";
            } else {
              val = val + "G";
            }

            sFnOpts.push(val);
            sFn.apply(null, sFnOpts);
          } else {
            sFnOpts.push(v.getAttribute("value"));
            sFn.apply(null, sFnOpts);
          }
        }
      }
    }
  });
}

let selectedSettingsTab = "settingsTabAccount";

/**
 * Modify the settings container UI when the scroll threshold reaches
 * a certain poin.
 *
 * @param {UIEvent} e The scroll event.
 */
function settingsTabScrollListener(e) {
  if (
    e.target.scrollTop >
    Number.parseFloat(getComputedStyle(e.target.firstElementChild).marginTop)
  ) {
    document.getElementById("settingsContainer").setAttribute("scrolled", "");
  } else {
    document.getElementById("settingsContainer").removeAttribute("scrolled");
  }
}

/**
 * Bind functionality for the settings navigation items.
 */
function setupSettingsTabs() {
  Array.from(document.getElementsByClassName("settingsNavItem")).map((val) => {
    if (val.hasAttribute("rSc")) {
      val.onclick = () => {
        settingsNavItemListener(val);
      };
    }
  });
}

/**
 * Settings nav item onclick lisener. Function is exposed so that
 * other UI elements can quickly toggle to a certain tab from other views.
 *
 * @param {Element} ele The nav item which has been clicked.
 * @param {boolean} fade Optional. True to fade transition.
 */
function settingsNavItemListener(ele, fade = true) {
  if (ele.hasAttribute("selected")) {
    return;
  }
  const navItems = document.getElementsByClassName("settingsNavItem");
  for (let i = 0; i < navItems.length; i++) {
    if (navItems[i].hasAttribute("selected")) {
      navItems[i].removeAttribute("selected");
    }
  }
  ele.setAttribute("selected", "");
  let prevTab = selectedSettingsTab;
  selectedSettingsTab = ele.getAttribute("rSc");

  document.getElementById(prevTab).onscroll = null;
  document.getElementById(selectedSettingsTab).onscroll =
    settingsTabScrollListener;

  if (fade) {
    $(`#${prevTab}`).fadeOut(250, () => {
      $(`#${selectedSettingsTab}`).fadeIn({
        duration: 250,
        start: () => {
          settingsTabScrollListener({
            target: document.getElementById(selectedSettingsTab),
          });
        },
      });
    });
  } else {
    $(`#${prevTab}`).hide(0, () => {
      $(`#${selectedSettingsTab}`).show({
        duration: 0,
        start: () => {
          settingsTabScrollListener({
            target: document.getElementById(selectedSettingsTab),
          });
        },
      });
    });
  }
}

function openSettingsAccountTab() {
  switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
    settingsNavItemListener(
      document.getElementById("settingsNavAccount"),
      false,
    );
  });
}

const settingsNavDone = document.getElementById("settingsNavDone");

/**
 * Set if the settings save (done) button is disabled.
 *
 * @param {boolean} v True to disable, false to enable.
 */
function settingsSaveDisabled(v) {
  settingsNavDone.disabled = v;
}

function fullSettingsSave() {
  saveSettingsValues();
  saveModConfiguration();
  ConfigManager.save();
  saveDropinModConfiguration();
  saveShaderpackSettings();
}

/* Closes the settings view and saves all data. */
settingsNavDone.onclick = () => {
  fullSettingsSave();
  switchView(getCurrentView(), VIEWS.landing);
};

/**
 * Account Management Tab
 */

const msftLoginLogger = LoggerUtil.getLogger("Microsoft Login");
const msftLogoutLogger = LoggerUtil.getLogger("Microsoft Logout");
const releaseNotesLogger = LoggerUtil.getLogger("Release Notes");

// Bind the add microsoft account button.
document.getElementById("settingsAddMicrosoftAccount").onclick = (e) => {
  switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
    beginMicrosoftDeviceLogin(VIEWS.settings);
  });
};

/**
 * Drive the Microsoft device-code login flow. AuthManager owns the
 * actual invoke() calls (start_microsoft_device_code, then
 * poll_microsoft_device_code) and token storage — this just supplies
 * the UI: show the code once it's available, open the verification
 * page, and react once the account is fully persisted.
 *
 * @param {string} viewOnClose The view to return to once the flow ends.
 */
async function beginMicrosoftDeviceLogin(viewOnClose) {
  // AuthManager keeps polling internally with no cancellation channel,
  // so dismissing the overlay here just tells us to ignore whatever
  // addMicrosoftAccount() eventually resolves/rejects with.
  let userCancelled = false;

  try {
    const { account } = await AuthManager.addMicrosoftAccount((deviceCode) => {
      setOverlayContent(
        Lang.queryJS("settings.msftLogin.deviceCodeTitle"),
        deviceCode.message,
        Lang.queryJS("settings.msftLogin.cancelButton"),
      );
      setOverlayHandler(() => {
        userCancelled = true;
        toggleOverlay(false);
        switchView(getCurrentView(), viewOnClose, 500, 500);

        AuthManager.cancelMicrosoftDeviceCode(deviceCode.device_code).catch(
          (err) => {
            msftLoginLogger.warn(
              "Failed to send login cancellation to Rust.",
              err,
            );
          },
        );
      });
      toggleOverlay(true);

      openPath(deviceCode.verification_uri).catch((err) => {
        msftLoginLogger.warn("Could not auto-open verification page.", err);
      });
    });

    if (userCancelled) return;

    toggleOverlay(false);
    msftLoginLogger.info(`Added Microsoft account ${account.uuid}.`);
    updateSelectedAccount(account);
    switchView(getCurrentView(), viewOnClose, 500, 500, async () => {
      await prepareSettings();
    });
  } catch (err) {
    if (userCancelled) return;
    msftLoginLogger.error("Microsoft login failed.", err);
    toggleOverlay(false);
    switchView(getCurrentView(), viewOnClose, 500, 500, () => {
      showMsftLoginError(err);
    });
  }
}

/**
 * Map a serialized AuthError (`{ kind, detail? }`, per auth_error.rs's
 * `#[serde(tag = "kind", content = "detail")]`) onto the overlay UI.
 *
 * @param {{kind: string, detail?: any}} err The rejected error value.
 */
function showMsftLoginError(err) {
  if (err?.kind === "Declined") {
    // User explicitly declined at the Microsoft sign-in prompt — no error overlay needed.
    return;
  }

  console.log("Microsoft login error:", err);

  setOverlayContent(
    Lang.queryJS("settings.msftLogin.errorTitle"),
    Lang.queryJS("settings.msftLogin.errorMessage"),
    Lang.queryJS("settings.msftLogin.okButton"),
  );
  setOverlayHandler(() => {
    toggleOverlay(false);
  });
  toggleOverlay(true);
}

/**
 * Bind functionality for the account selection buttons. If another account
 * is selected, the UI of the previously selected account will be updated.
 */
function bindAuthAccountSelect() {
  Array.from(document.getElementsByClassName("settingsAuthAccountSelect")).map(
    (val) => {
      val.onclick = (e) => {
        if (val.hasAttribute("selected")) {
          return;
        }
        const selectBtns = document.getElementsByClassName(
          "settingsAuthAccountSelect",
        );
        for (let i = 0; i < selectBtns.length; i++) {
          if (selectBtns[i].hasAttribute("selected")) {
            selectBtns[i].removeAttribute("selected");
            selectBtns[i].innerHTML = Lang.queryJS(
              "settings.authAccountSelect.selectButton",
            );
          }
        }
        val.setAttribute("selected", "");
        val.innerHTML = Lang.queryJS(
          "settings.authAccountSelect.selectedButton",
        );
        const newlySelected = ConfigManager.setSelectedAccount(
          val.closest(".settingsAuthAccount").getAttribute("uuid"),
        );
        ConfigManager.save();
        updateSelectedAccount(newlySelected);
      };
    },
  );
}

/**
 * Bind functionality for the log out button. If the logged out account was
 * the selected account, another account will be selected and the UI will
 * be updated accordingly.
 */
function bindAuthAccountLogOut() {
  Array.from(document.getElementsByClassName("settingsAuthAccountLogOut")).map(
    (val) => {
      val.onclick = (e) => {
        let isLastAccount = false;
        if (Object.keys(ConfigManager.getAuthAccounts()).length === 1) {
          isLastAccount = true;
          setOverlayContent(
            Lang.queryJS("settings.authAccountLogout.lastAccountWarningTitle"),
            Lang.queryJS(
              "settings.authAccountLogout.lastAccountWarningMessage",
            ),
            Lang.queryJS("settings.authAccountLogout.confirmButton"),
            Lang.queryJS("settings.authAccountLogout.cancelButton"),
          );
          setOverlayHandler(() => {
            processLogOut(val, isLastAccount);
            toggleOverlay(false);
          });
          setDismissHandler(() => {
            toggleOverlay(false);
          });
          toggleOverlay(true, true);
        } else {
          processLogOut(val, isLastAccount);
        }
      };
    },
  );
}

let msAccDomElementCache;
/**
 * Process a log out.
 *
 * @param {Element} val The log out button element.
 * @param {boolean} isLastAccount If this logout is on the last added account.
 */
async function processLogOut(val, isLastAccount) {
  const parent = val.closest(".settingsAuthAccount");
  const uuid = parent.getAttribute("uuid");
  const prevSelAcc = ConfigManager.getSelectedAccount();

  try {
    await AuthManager.removeMicrosoftAccount(uuid);
  } catch (err) {
    msftLogoutLogger.error("Logout failed for uuid:", uuid, err);
    setOverlayContent(
      Lang.queryJS("settings.authAccountLogout.errorTitle"),
      Lang.queryJS("settings.authAccountLogout.errorMessage"),
      Lang.queryJS("settings.authAccountLogout.okButton"),
    );
    setOverlayHandler(() => toggleOverlay(false));
    toggleOverlay(true);
    return;
  }

  msftLogoutLogger.info("Logout Successful. uuid:", uuid);

  try {
    if (!isLastAccount && uuid === prevSelAcc.uuid) {
      const selAcc = ConfigManager.getSelectedAccount();
      refreshAuthAccountSelected(selAcc.uuid);
      updateSelectedAccount(selAcc);
      validateSelectedAccount();
    }
    if (isLastAccount) {
      loginOptionsCancelEnabled(false);
      setLoginOptionsViewOnLoginSuccess(VIEWS.settings);
      setLoginOptionsViewOnLoginCancel(VIEWS.loginOptions);
      switchView(getCurrentView(), VIEWS.loginOptions);
    }
    if (msAccDomElementCache) {
      msAccDomElementCache.remove();
      msAccDomElementCache = null;
    }
  } finally {
    if (!isLastAccount) {
      switchView(getCurrentView(), VIEWS.settings, 500, 500);
    }
  }
}

/**
 * Refreshes the status of the selected account on the auth account
 * elements.
 *
 * @param {string} uuid The UUID of the new selected account.
 */
function refreshAuthAccountSelected(uuid) {
  Array.from(document.getElementsByClassName("settingsAuthAccount")).map(
    (val) => {
      const selBtn = val.getElementsByClassName("settingsAuthAccountSelect")[0];
      if (uuid === val.getAttribute("uuid")) {
        selBtn.setAttribute("selected", "");
        selBtn.innerHTML = Lang.queryJS(
          "settings.authAccountSelect.selectedButton",
        );
      } else {
        if (selBtn.hasAttribute("selected")) {
          selBtn.removeAttribute("selected");
        }
        selBtn.innerHTML = Lang.queryJS(
          "settings.authAccountSelect.selectButton",
        );
      }
    },
  );
}

const settingsCurrentMicrosoftAccounts = document.getElementById(
  "settingsCurrentMicrosoftAccounts",
);

/**
 * Add auth account elements for each one stored in the authentication database.
 */
function populateAuthAccounts() {
  const authAccounts = ConfigManager.getAuthAccounts();
  const authKeys = Object.keys(authAccounts);

  if (authKeys.length === 0) {
    return;
  }

  const selectedUUID = ConfigManager.getSelectedAccount().uuid;

  let microsoftAuthAccountStr = "";

  authKeys.forEach((val) => {
    const acc = authAccounts[val];

    const accHtml = `<div class="settingsAuthAccount" uuid="${acc.uuid}">
            <div class="settingsAuthAccountLeft">
                <img class="settingsAuthAccountImage" alt="${acc.displayName}" src="https://mc-heads.net/head/${acc.uuid}/60">
            </div>
            <div class="settingsAuthAccountRight">
                <div class="settingsAuthAccountDetails">
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS("settings.authAccountPopulate.username")}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.displayName}</div>
                    </div>
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS("settings.authAccountPopulate.uuid")}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.uuid}</div>
                    </div>
                </div>
                <div class="settingsAuthAccountActions">
                    <button class="settingsAuthAccountSelect" ${selectedUUID === acc.uuid ? "selected>" + Lang.queryJS("settings.authAccountPopulate.selectedAccount") : ">" + Lang.queryJS("settings.authAccountPopulate.selectAccount")}</button>
                    <div class="settingsAuthAccountWrapper">
                        <button class="settingsAuthAccountLogOut">${Lang.queryJS("settings.authAccountPopulate.logout")}</button>
                    </div>
                </div>
            </div>
        </div>`;

    microsoftAuthAccountStr += accHtml;
  });

  settingsCurrentMicrosoftAccounts.innerHTML = microsoftAuthAccountStr;
}

/**
 * Prepare the accounts tab for display.
 */
function prepareAccountsTab() {
  populateAuthAccounts();
  bindAuthAccountSelect();
  bindAuthAccountLogOut();
}

/**
 * Minecraft Tab
 */

/**
 * Disable decimals, negative signs, and scientific notation.
 */
document
  .getElementById("settingsGameWidth")
  .addEventListener("keydown", (e) => {
    if (/^[-.eE]$/.test(e.key)) {
      e.preventDefault();
    }
  });
document
  .getElementById("settingsGameHeight")
  .addEventListener("keydown", (e) => {
    if (/^[-.eE]$/.test(e.key)) {
      e.preventDefault();
    }
  });

/**
 * Mods Tab
 */

const settingsModsContainer = document.getElementById("settingsModsContainer");

/**
 * Resolve and update the mods on the UI.
 */
async function resolveModsForUI() {
  const serv = ConfigManager.getSelectedServer();
  const distro = await DistroAPI.getDistribution();
  const server = distro.getServerById(serv);
  if (server == null) return;

  const servConf = ConfigManager.getModConfiguration(serv);
  const modStr = parseModulesForUI(server.modules, false, servConf.mods);

  document.getElementById("settingsReqModsContent").innerHTML = modStr.reqMods;
  document.getElementById("settingsOptModsContent").innerHTML = modStr.optMods;
}

/**
 * Recursively build the mod UI elements.
 *
 * @param {Object[]} mdls An array of modules to parse.
 * @param {boolean} submodules Whether or not we are parsing submodules.
 * @param {Object} servConf The server configuration object for this module level.
 */
function parseModulesForUI(mdls, submodules, servConf) {
  let reqMods = "";
  let optMods = "";

  for (const mdl of mdls) {
    if (
      mdl.rawModule.type === Type.ForgeMod ||
      mdl.rawModule.type === Type.LiteMod ||
      mdl.rawModule.type === Type.LiteLoader ||
      mdl.rawModule.type === Type.FabricMod
    ) {
      if (mdl.getRequired().value) {
        reqMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settings${submodules ? "Sub" : ""}Mod" enabled>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${mdl.rawModule.name}</span>
                                <span class="settingsModVersion">v${mdl.mavenComponents.version}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch" reqmod>
                            <input type="checkbox" checked>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                    ${
                      mdl.subModules.length > 0
                        ? `<div class="settingsSubModContainer">
                        ${Object.values(parseModulesForUI(mdl.subModules, true, servConf[mdl.getVersionlessMavenIdentifier()])).join("")}
                    </div>`
                        : ""
                    }
                </div>`;
      } else {
        const conf = servConf[mdl.getVersionlessMavenIdentifier()];
        const val = typeof conf === "object" ? conf.value : conf;

        optMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settings${submodules ? "Sub" : ""}Mod" ${val ? "enabled" : ""}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${mdl.rawModule.name}</span>
                                <span class="settingsModVersion">v${mdl.mavenComponents.version}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${mdl.getVersionlessMavenIdentifier()}" ${val ? "checked" : ""}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                    ${
                      mdl.subModules.length > 0
                        ? `<div class="settingsSubModContainer">
                        ${Object.values(parseModulesForUI(mdl.subModules, true, conf.mods)).join("")}
                    </div>`
                        : ""
                    }
                </div>`;
      }
    }
  }

  return {
    reqMods,
    optMods,
  };
}

/**
 * Bind functionality to mod config toggle switches. Switching the value
 * will also switch the status color on the left of the mod UI.
 */
function bindModsToggleSwitch() {
  const sEls = settingsModsContainer.querySelectorAll("[formod]");
  Array.from(sEls).map((v, index, arr) => {
    v.onchange = () => {
      if (v.checked) {
        document
          .getElementById(v.getAttribute("formod"))
          .setAttribute("enabled", "");
      } else {
        document
          .getElementById(v.getAttribute("formod"))
          .removeAttribute("enabled");
      }
    };
  });
}

/**
 * Save the mod configuration based on the UI values.
 */
function saveModConfiguration() {
  const serv = ConfigManager.getSelectedServer();
  let modConf = ConfigManager.getModConfiguration(serv);
  if (!modConf) {
    modConf = { id: serv, mods: {} };
  }
  modConf.mods = _saveModConfiguration(modConf.mods);
  ConfigManager.setModConfiguration(serv, modConf);
}

/**
 * Recursively save mod config with submods.
 *
 * @param {Object} modConf Mod config object to save.
 */
function _saveModConfiguration(modConf) {
  for (let m of Object.entries(modConf)) {
    const tSwitch = settingsModsContainer.querySelectorAll(
      `[formod='${m[0]}']`,
    );
    if (!tSwitch[0].hasAttribute("dropin")) {
      if (typeof m[1] === "boolean") {
        modConf[m[0]] = tSwitch[0].checked;
      } else {
        if (m[1] != null) {
          if (tSwitch.length > 0) {
            modConf[m[0]].value = tSwitch[0].checked;
          }
          modConf[m[0]].mods = _saveModConfiguration(modConf[m[0]].mods);
        }
      }
    }
  }
  return modConf;
}

// Drop-in mod elements.

let CACHE_SETTINGS_MODS_DIR;
let CACHE_DROPIN_MODS;

/**
 * Resolve any located drop-in mods for this server and
 * populate the results onto the UI.
 */
async function resolveDropinModsForUI() {
  const serv = (await DistroAPI.getDistribution()).getServerById(
    ConfigManager.getSelectedServer(),
  );
  if (serv == null) return;

  CACHE_SETTINGS_MODS_DIR = path.join(
    ConfigManager.getInstanceDirectory(),
    serv.rawServer.id,
    "mods",
  );
  CACHE_DROPIN_MODS = DropinModUtil.scanForDropinMods(
    CACHE_SETTINGS_MODS_DIR,
    serv.rawServer.minecraftVersion,
  );

  let dropinMods = "";

  for (const dropin of CACHE_DROPIN_MODS) {
    dropinMods += `<div id="${dropin.fullName}" class="settingsBaseMod settingsDropinMod" ${!dropin.disabled ? "enabled" : ""}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${dropin.name}</span>
                                <div class="settingsDropinRemoveWrapper">
                                    <button class="settingsDropinRemoveButton" remmod="${dropin.fullName}">${Lang.queryJS("settings.dropinMods.removeButton")}</button>
                                </div>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${dropin.fullName}" dropin ${!dropin.disabled ? "checked" : ""}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                </div>`;
  }

  document.getElementById("settingsDropinModsContent").innerHTML = dropinMods;
}

/**
 * Bind the remove button for each loaded drop-in mod.
 */
function bindDropinModsRemoveButton() {
  const sEls = settingsModsContainer.querySelectorAll("[remmod]");
  Array.from(sEls).map((v, index, arr) => {
    v.onclick = async () => {
      const fullName = v.getAttribute("remmod");
      const res = await DropinModUtil.deleteDropinMod(
        CACHE_SETTINGS_MODS_DIR,
        fullName,
      );
      if (res) {
        document.getElementById(fullName).remove();
      } else {
        setOverlayContent(
          Lang.queryJS("settings.dropinMods.deleteFailedTitle", { fullName }),
          Lang.queryJS("settings.dropinMods.deleteFailedMessage"),
          Lang.queryJS("settings.dropinMods.okButton"),
        );
        setOverlayHandler(null);
        toggleOverlay(true);
      }
    };
  });
}

/**
 * Bind functionality to the file system button for the selected
 * server configuration.
 */
function bindDropinModFileSystemButton() {
  const fsBtn = document.getElementById("settingsDropinFileSystemButton");
  fsBtn.onclick = () => {
    DropinModUtil.validateDir(CACHE_SETTINGS_MODS_DIR);
    shell.openPath(CACHE_SETTINGS_MODS_DIR);
  };
  fsBtn.ondragenter = (e) => {
    e.dataTransfer.dropEffect = "move";
    fsBtn.setAttribute("drag", "");
    e.preventDefault();
  };
  fsBtn.ondragover = (e) => {
    e.preventDefault();
  };
  fsBtn.ondragleave = (e) => {
    fsBtn.removeAttribute("drag");
  };

  fsBtn.ondrop = async (e) => {
    fsBtn.removeAttribute("drag");
    e.preventDefault();

    DropinModUtil.addDropinMods(e.dataTransfer.files, CACHE_SETTINGS_MODS_DIR);
    await reloadDropinMods();
  };
}

/**
 * Save drop-in mod states. Enabling and disabling is just a matter
 * of adding/removing the .disabled extension.
 */
function saveDropinModConfiguration() {
  if (CACHE_SETTINGS_MODS_DIR == null || CACHE_DROPIN_MODS == null) return;
  for (const dropin of CACHE_DROPIN_MODS) {
    const dropinUI = document.getElementById(dropin.fullName);
    if (dropinUI != null) {
      const dropinUIEnabled = dropinUI.hasAttribute("enabled");
      if (
        DropinModUtil.isDropinModEnabled(dropin.fullName) != dropinUIEnabled
      ) {
        DropinModUtil.toggleDropinMod(
          CACHE_SETTINGS_MODS_DIR,
          dropin.fullName,
          dropinUIEnabled,
        ).catch((err) => {
          if (!isOverlayVisible()) {
            setOverlayContent(
              Lang.queryJS("settings.dropinMods.failedToggleTitle"),
              err.message,
              Lang.queryJS("settings.dropinMods.okButton"),
            );
            setOverlayHandler(null);
            toggleOverlay(true);
          }
        });
      }
    }
  }
}

// Refresh the drop-in mods when F5 is pressed.
// Only active on the mods tab.
document.addEventListener("keydown", async (e) => {
  if (
    getCurrentView() === VIEWS.settings &&
    selectedSettingsTab === "settingsTabMods"
  ) {
    if (e.key === "F5") {
      await reloadDropinMods();
      saveShaderpackSettings();
      await resolveShaderpacksForUI();
    }
  }
});

async function reloadDropinMods() {
  await resolveDropinModsForUI();
  bindDropinModsRemoveButton();
  bindDropinModFileSystemButton();
  bindModsToggleSwitch();
}

// Shaderpack

let CACHE_SETTINGS_INSTANCE_DIR;
let CACHE_SHADERPACKS;
let CACHE_SELECTED_SHADERPACK;

/**
 * Load shaderpack information.
 */
async function resolveShaderpacksForUI() {
  const serv = (await DistroAPI.getDistribution()).getServerById(
    ConfigManager.getSelectedServer(),
  );
  if (serv == null) return;

  CACHE_SETTINGS_INSTANCE_DIR = path.join(
    ConfigManager.getInstanceDirectory(),
    serv.rawServer.id,
  );
  CACHE_SHADERPACKS = DropinModUtil.scanForShaderpacks(
    CACHE_SETTINGS_INSTANCE_DIR,
  );
  CACHE_SELECTED_SHADERPACK = DropinModUtil.getEnabledShaderpack(
    CACHE_SETTINGS_INSTANCE_DIR,
  );

  setShadersOptions(CACHE_SHADERPACKS, CACHE_SELECTED_SHADERPACK);
}

function setShadersOptions(arr, selected) {
  const cont = document.getElementById("settingsShadersOptions");
  cont.innerHTML = "";
  for (let opt of arr) {
    const d = document.createElement("DIV");
    d.innerHTML = opt.name;
    d.setAttribute("value", opt.fullName);
    if (opt.fullName === selected) {
      d.setAttribute("selected", "");
      document.getElementById("settingsShadersSelected").innerHTML = opt.name;
    }
    d.addEventListener("click", function (e) {
      this.parentNode.previousElementSibling.innerHTML = this.innerHTML;
      for (let sib of this.parentNode.children) {
        sib.removeAttribute("selected");
      }
      this.setAttribute("selected", "");
      closeSettingsSelect();
    });
    cont.appendChild(d);
  }
}

function saveShaderpackSettings() {
  if (CACHE_SETTINGS_INSTANCE_DIR == null) return;
  let sel = "OFF";
  for (let opt of document.getElementById("settingsShadersOptions").children) {
    if (opt.hasAttribute("selected")) {
      sel = opt.getAttribute("value");
    }
  }
  DropinModUtil.setEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR, sel);
}

function bindShaderpackButton() {
  const spBtn = document.getElementById("settingsShaderpackButton");
  spBtn.onclick = () => {
    if (CACHE_SETTINGS_INSTANCE_DIR == null) return;
    const p = path.join(CACHE_SETTINGS_INSTANCE_DIR, "shaderpacks");
    DropinModUtil.validateDir(p);
    shell.openPath(p);
  };
  spBtn.ondragenter = (e) => {
    e.dataTransfer.dropEffect = "move";
    spBtn.setAttribute("drag", "");
    e.preventDefault();
  };
  spBtn.ondragover = (e) => {
    e.preventDefault();
  };
  spBtn.ondragleave = (e) => {
    spBtn.removeAttribute("drag");
  };

  spBtn.ondrop = async (e) => {
    spBtn.removeAttribute("drag");
    e.preventDefault();

    if (CACHE_SETTINGS_INSTANCE_DIR == null) return;
    DropinModUtil.addShaderpacks(
      e.dataTransfer.files,
      CACHE_SETTINGS_INSTANCE_DIR,
    );
    saveShaderpackSettings();
    await resolveShaderpacksForUI();
  };
}

// Server status bar functions.

/**
 * Load the currently selected server information onto the mods tab.
 */
async function loadSelectedServerOnModsTab() {
  const serv = (await DistroAPI.getDistribution()).getServerById(
    ConfigManager.getSelectedServer(),
  );
  if (serv == null) return;

  for (const el of document.getElementsByClassName("settingsSelServContent")) {
    el.innerHTML = `
            <img class="serverListingImg" src="${serv.rawServer.icon}"/>
            <div class="serverListingDetails">
                <span class="serverListingName">${serv.rawServer.name}</span>
                <span class="serverListingDescription">${serv.rawServer.description}</span>
                <div class="serverListingInfo">
                    <div class="serverListingVersion">${serv.rawServer.minecraftVersion}</div>
                    <div class="serverListingRevision">${serv.rawServer.version}</div>
                    ${
                      serv.rawServer.mainServer
                        ? `<div class="serverListingStarWrapper">
                        <svg id="Layer_1" viewBox="0 0 107.45 104.74" width="20px" height="20px">
                            <defs>
                                <style>.cls-1{fill:#fff;}.cls-2{fill:none;stroke:#fff;stroke-miterlimit:10;}</style>
                            </defs>
                            <path class="cls-1" d="M100.93,65.54C89,62,68.18,55.65,63.54,52.13c2.7-5.23,18.8-19.2,28-27.55C81.36,31.74,63.74,43.87,58.09,45.3c-2.41-5.37-3.61-26.52-4.37-39-.77,12.46-2,33.64-4.36,39-5.7-1.46-23.3-13.57-33.49-20.72,9.26,8.37,25.39,22.36,28,27.55C39.21,55.68,18.47,62,6.52,65.55c12.32-2,33.63-6.06,39.34-4.9-.16,5.87-8.41,26.16-13.11,37.69,6.1-10.89,16.52-30.16,21-33.9,4.5,3.79,14.93,23.09,21,34C70,86.84,61.73,66.48,61.59,60.65,67.36,59.49,88.64,63.52,100.93,65.54Z"/>
                            <circle class="cls-2" cx="53.73" cy="53.9" r="38"/>
                        </svg>
                        <span class="serverListingStarTooltip">${Lang.queryJS("settings.serverListing.mainServer")}</span>
                    </div>`
                        : ""
                    }
                </div>
            </div>
        `;
  }
}

// Bind functionality to the server switch button.
Array.from(
  document.getElementsByClassName("settingsSwitchServerButton"),
).forEach((el) => {
  el.addEventListener("click", async (e) => {
    e.target.blur();
    await toggleServerSelection(true);
  });
});

/**
 * Save mod configuration for the current selected server.
 */
function saveAllModConfigurations() {
  saveModConfiguration();
  ConfigManager.save();
  saveDropinModConfiguration();
}

/**
 * Function to refresh the current tab whenever the selected
 * server is changed.
 */
function animateSettingsTabRefresh() {
  $(`#${selectedSettingsTab}`).fadeOut(500, async () => {
    await prepareSettings();
    $(`#${selectedSettingsTab}`).fadeIn(500);
  });
}

/**
 * Prepare the Mods tab for display.
 */
async function prepareModsTab(first) {
  await resolveModsForUI();
  await resolveDropinModsForUI();
  await resolveShaderpacksForUI();
  bindDropinModsRemoveButton();
  bindDropinModFileSystemButton();
  bindShaderpackButton();
  bindModsToggleSwitch();
  await loadSelectedServerOnModsTab();
}

/**
 * Java Tab
 */

// DOM Cache
const settingsMaxRAMRange = document.getElementById("settingsMaxRAMRange");
const settingsMinRAMRange = document.getElementById("settingsMinRAMRange");
const settingsMaxRAMLabel = document.getElementById("settingsMaxRAMLabel");
const settingsMinRAMLabel = document.getElementById("settingsMinRAMLabel");
const settingsMemoryTotal = document.getElementById("settingsMemoryTotal");
const settingsMemoryAvail = document.getElementById("settingsMemoryAvail");
const settingsJavaExecDetails = document.getElementById(
  "settingsJavaExecDetails",
);
const settingsJavaReqDesc = document.getElementById("settingsJavaReqDesc");
const settingsJvmOptsLink = document.getElementById("settingsJvmOptsLink");
const settingsJavaExecVal = document.getElementById("settingsJavaExecVal");

// Bind on change event for min memory container.
settingsMinRAMRange.onchange = (e) => {
  const sMaxV = Number(settingsMaxRAMRange.getAttribute("value"));
  const sMinV = Number(settingsMinRAMRange.getAttribute("value"));
  const bar = e.target.getElementsByClassName("rangeSliderBar")[0];
  const max = getCachedMemoryInfo().total_mem / 1073741824;

  // Change range bar color based on the selected value.
  if (sMinV >= max / 2) {
    bar.style.background = "#e86060";
  } else if (sMinV >= max / 4) {
    bar.style.background = "#e8e18b";
  } else {
    bar.style.background = null;
  }

  // Increase maximum memory if the minimum exceeds its value.
  if (sMaxV < sMinV) {
    const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange);
    updateRangedSlider(
      settingsMaxRAMRange,
      sMinV,
      ((sMinV - sliderMeta.min) / sliderMeta.step) * sliderMeta.inc,
    );
    settingsMaxRAMLabel.innerHTML = sMinV.toFixed(1) + "G";
  }

  // Update label
  settingsMinRAMLabel.innerHTML = sMinV.toFixed(1) + "G";
};

// Bind on change event for max memory container.
settingsMaxRAMRange.onchange = (e) => {
  // Current range values
  const sMaxV = Number(settingsMaxRAMRange.getAttribute("value"));
  const sMinV = Number(settingsMinRAMRange.getAttribute("value"));

  // Get reference to range bar.
  const bar = e.target.getElementsByClassName("rangeSliderBar")[0];

  // Calculate effective total memory.
  const max = getCachedMemoryInfo().total_mem / 1073741824;

  // Change range bar color based on the selected value.
  if (sMaxV >= max / 2) {
    bar.style.background = "#e86060";
  } else if (sMaxV >= max / 4) {
    bar.style.background = "#e8e18b";
  } else {
    bar.style.background = null;
  }

  // Decrease the minimum memory if the maximum value is less.
  if (sMaxV < sMinV) {
    const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange);

    updateRangedSlider(
      settingsMinRAMRange,
      sMaxV,
      ((sMaxV - sliderMeta.min) / sliderMeta.step) * sliderMeta.inc,
    );

    settingsMinRAMLabel.innerHTML = sMaxV.toFixed(1) + "G";
  }

  settingsMaxRAMLabel.innerHTML = sMaxV.toFixed(1) + "G";
};

/**
 * Calculate common values for a ranged slider.
 *
 * @param {Element} v The range slider to calculate against.
 * @returns {Object} An object with meta values for the provided ranged slider.
 */
function calculateRangeSliderMeta(v) {
  const val = {
    max: Number(v.getAttribute("max")),
    min: Number(v.getAttribute("min")),
    step: Number(v.getAttribute("step")),
  };
  val.ticks = (val.max - val.min) / val.step;
  val.inc = 100 / val.ticks;
  return val;
}

/**
 * Binds functionality to the ranged sliders.
 */
function bindRangeSlider(server, totalMem) {
  settingsMaxRAMRange.onchange = (e) => {
    const sMaxV = Number(settingsMaxRAMRange.getAttribute("value"));
    const sMinV = Number(settingsMinRAMRange.getAttribute("value"));

    const bar = e.target.getElementsByClassName("rangeSliderBar")[0];

    const max = totalMem / 1073741824;

    if (sMaxV >= max / 2) {
      bar.style.background = "#e86060";
    } else if (sMaxV >= max / 4) {
      bar.style.background = "#e8e18b";
    } else {
      bar.style.background = null;
    }

    if (sMaxV < sMinV) {
      const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange);

      updateRangedSlider(
        settingsMinRAMRange,
        sMaxV,
        ((sMaxV - sliderMeta.min) / sliderMeta.step) * sliderMeta.inc,
      );

      settingsMinRAMLabel.innerHTML = sMaxV.toFixed(1) + "G";
    }

    settingsMaxRAMLabel.innerHTML = sMaxV.toFixed(1) + "G";
  };
}

/**
 * Update a ranged slider's value and position.
 *
 * @param {Element} element The ranged slider to update.
 * @param {string | number} value The new value for the ranged slider.
 * @param {number} notch The notch that the slider should now be at.
 */
function updateRangedSlider(element, value, notch) {
  const oldVal = element.getAttribute("value");
  const bar = element.getElementsByClassName("rangeSliderBar")[0];
  const track = element.getElementsByClassName("rangeSliderTrack")[0];

  element.setAttribute("value", value);

  if (notch < 0) {
    notch = 0;
  } else if (notch > 100) {
    notch = 100;
  }

  const event = new MouseEvent("change", {
    target: element,
    type: "change",
    bubbles: false,
    cancelable: true,
  });

  let cancelled = !element.dispatchEvent(event);

  if (!cancelled) {
    track.style.left = notch + "%";
    bar.style.width = notch + "%";
  } else {
    element.setAttribute("value", oldVal);
  }
}

/**
 * Display the total and available RAM.
 */
function populateMemoryStatus(totalMem, freeMem) {
  settingsMemoryTotal.innerHTML =
    Number(totalMem / 1073741824).toFixed(1) + "G";
  settingsMemoryAvail.innerHTML = Number(freeMem / 1073741824).toFixed(1) + "G";
}

/**
 * Validate the provided executable path and display the data on
 * the UI.
 *
 * @param {string} execPath The executable path to populate against.
 */
async function populateJavaExecDetails(execPath) {
  const server = (await DistroAPI.getDistribution()).getServerById(
    ConfigManager.getSelectedServer(),
  );

  if (server == null) {
    // No server selected/available yet — nothing to validate against.
    settingsJavaExecDetails.innerHTML = "";
    return;
  }

  const details = await validateSelectedJvm(
    ensureJavaDirIsRoot(execPath),
    server.effectiveJavaOptions.supported,
  );
  if (details != null) {
    settingsJavaExecDetails.innerHTML = Lang.queryJS(
      "settings.java.selectedJava",
      { version: details.semverStr, vendor: details.vendor },
    );
  } else {
    settingsJavaExecDetails.innerHTML = Lang.queryJS(
      "settings.java.invalidSelection",
    );
  }
}

/**
 * Update the Java executable input and validation details on the Settings UI.
 * Safe to call even if the Settings view isn't currently rendered.
 *
 * @param {string} execPath The new Java executable path.
 */
export async function syncJavaExecutableSelection(execPath) {
  if (settingsJavaExecVal != null) {
    settingsJavaExecVal.value = execPath;
  }
  await populateJavaExecDetails(execPath);
}

function populateJavaReqDesc(server) {
  settingsJavaReqDesc.innerHTML = Lang.queryJS("settings.java.requiresJava", {
    major: server.effectiveJavaOptions.suggestedMajor,
  });
}

function populateJvmOptsLink(server) {
  const major = server.effectiveJavaOptions.suggestedMajor;
  settingsJvmOptsLink.innerHTML = Lang.queryJS(
    "settings.java.availableOptions",
    { major: major },
  );
  if (major >= 12) {
    settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/docs/technotes/tools/${platform() === "windows" ? "windows" : "unix"}/java.html`;
  } else if (major >= 11) {
    settingsJvmOptsLink.href =
      "https://docs.oracle.com/en/java/javase/11/tools/java.html#GUID-3B1CE181-CD30-4178-9602-230B800D4FAE";
  } else if (major >= 9) {
    settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/tools/java.htm`;
  } else {
    settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/docs/technotes/tools/${platform() === "windows" ? "windows" : "unix"}/java.html`;
  }
}

function bindMinMaxRam(server) {
  const SETTINGS_MAX_MEMORY = ConfigManager.getAbsoluteMaxRAM(
    server.rawServer.javaOptions?.ram,
  );
  const SETTINGS_MIN_MEMORY = ConfigManager.getAbsoluteMinRAM(
    server.rawServer.javaOptions?.ram,
  );
  settingsMaxRAMRange.setAttribute("max", SETTINGS_MAX_MEMORY);
  settingsMaxRAMRange.setAttribute("min", SETTINGS_MIN_MEMORY);
  settingsMinRAMRange.setAttribute("max", SETTINGS_MAX_MEMORY);
  settingsMinRAMRange.setAttribute("min", SETTINGS_MIN_MEMORY);
}

/**
 * Prepare the Java tab for display.
 */
async function prepareJavaTab() {
  const { total_mem, free_mem } = await getMemoryInfo();
  populateMemoryStatus(total_mem, free_mem);

  const server = (await DistroAPI.getDistribution()).getServerById(
    ConfigManager.getSelectedServer(),
  );
  if (server == null) return;

  bindMinMaxRam(server);
  bindRangeSlider(server, total_mem);
  populateJavaReqDesc(server);
  populateJvmOptsLink(server);
}

/**
 * About Tab
 */

const settingsTabAbout = document.getElementById("settingsTabAbout");
const settingsAboutChangelogTitle = settingsTabAbout.getElementsByClassName(
  "settingsChangelogTitle",
)[0];
const settingsAboutChangelogText = settingsTabAbout.getElementsByClassName(
  "settingsChangelogText",
)[0];
const settingsAboutChangelogButton = settingsTabAbout.getElementsByClassName(
  "settingsChangelogButton",
)[0];

// Bind the devtools toggle button.
document.getElementById("settingsAboutDevToolsButton").onclick = (e) => {
  let window = getCurrentWindow();
  window.toggleDevTools();
};

/**
 * Return whether or not the provided version is a prerelease.
 *
 * @param {string} version The semver version to test.
 * @returns {boolean} True if the version is a prerelease, otherwise false.
 */
function isPrerelease(version) {
  const preRelComp = semver.prerelease(version);
  return preRelComp != null && preRelComp.length > 0;
}

/**
 * Utility method to display version information on the
 * About and Update settings tabs.
 *
 * @param {string} version The semver version to display.
 * @param {Element} valueElement The value element.
 * @param {Element} titleElement The title element.
 * @param {Element} checkElement The check mark element.
 */
function populateVersionInformation(
  version,
  valueElement,
  titleElement,
  checkElement,
) {
  valueElement.innerHTML = version;
  if (isPrerelease(version)) {
    titleElement.innerHTML = Lang.queryJS("settings.about.preReleaseTitle");
    titleElement.style.color = "#ff886d";
    checkElement.style.background = "#ff886d";
  } else {
    titleElement.innerHTML = Lang.queryJS("settings.about.stableReleaseTitle");
    titleElement.style.color = null;
    checkElement.style.background = null;
  }
}

/**
 * Retrieve the version information and display it on the UI.
 */
function populateAboutVersionInformation() {
  populateVersionInformation(
    getVersion(),
    document.getElementById("settingsAboutCurrentVersionValue"),
    document.getElementById("settingsAboutCurrentVersionTitle"),
    document.getElementById("settingsAboutCurrentVersionCheck"),
  );
}

/**
 * Fetches the GitHub atom release feed and parses it for the release notes
 * of the current version. This value is displayed on the UI.
 */
async function populateReleaseNotes() {
  try {
    const response = await fetch(
      "https://github.com/Redllamaaa/tsmplauncher/releases.atom",
    );

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const text = await response.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "application/xml");

    const version = "v" + getVersion();
    const entries = $(xml).find("entry");

    for (let i = 0; i < entries.length; i++) {
      const entry = $(entries[i]);
      let id = entry.find("id").text();
      id = id.substring(id.lastIndexOf("/") + 1);

      if (id === version) {
        settingsAboutChangelogTitle.innerHTML = entry.find("title").text();
        settingsAboutChangelogText.innerHTML = entry.find("content").text();
        settingsAboutChangelogButton.href = entry.find("link").attr("href");
        break;
      }
    }
  } catch (err) {
    releaseNotesLogger.error("Failed to load release notes:", err);
    settingsAboutChangelogText.innerHTML = Lang.queryJS(
      "settings.about.releaseNotesFailed",
    );
  }
}

/**
 * Prepare account tab for display.
 */
function prepareAboutTab() {
  populateAboutVersionInformation();
  populateReleaseNotes();
}

/**
 * Update Tab
 */

const settingsTabUpdate = document.getElementById("settingsTabUpdate");
const settingsUpdateTitle = document.getElementById("settingsUpdateTitle");
const settingsUpdateVersionCheck = document.getElementById(
  "settingsUpdateVersionCheck",
);
const settingsUpdateVersionTitle = document.getElementById(
  "settingsUpdateVersionTitle",
);
const settingsUpdateVersionValue = document.getElementById(
  "settingsUpdateVersionValue",
);
const settingsUpdateChangelogTitle = settingsTabUpdate.getElementsByClassName(
  "settingsChangelogTitle",
)[0];
const settingsUpdateChangelogText = settingsTabUpdate.getElementsByClassName(
  "settingsChangelogText",
)[0];
const settingsUpdateChangelogCont = settingsTabUpdate.getElementsByClassName(
  "settingsChangelogContainer",
)[0];
const settingsUpdateActionButton = document.getElementById(
  "settingsUpdateActionButton",
);

/**
 * Update the properties of the update action button.
 *
 * @param {string} text The new button text.
 * @param {boolean} disabled Optional. Disable or enable the button
 * @param {function} handler Optional. New button event handler.
 */
function settingsUpdateButtonStatus(text, disabled = false, handler = null) {
  settingsUpdateActionButton.innerHTML = text;
  settingsUpdateActionButton.disabled = disabled;
  if (handler != null) {
    settingsUpdateActionButton.onclick = handler;
  }
}

/**
 * Populate the update tab with relevant information.
 *
 * @param {Object} data The update data.
 */
function populateSettingsUpdateInformation(data) {
  if (data != null) {
    settingsUpdateTitle.innerHTML = isPrerelease(data.version)
      ? Lang.queryJS("settings.updates.newPreReleaseTitle")
      : Lang.queryJS("settings.updates.newReleaseTitle");
    settingsUpdateChangelogCont.style.display = null;
    settingsUpdateChangelogTitle.innerHTML = data.releaseName;
    settingsUpdateChangelogText.innerHTML = data.releaseNotes;
    populateVersionInformation(
      data.version,
      settingsUpdateVersionValue,
      settingsUpdateVersionTitle,
      settingsUpdateVersionCheck,
    );

    if (platform() === "macos") {
      settingsUpdateButtonStatus(
        Lang.queryJS("settings.updates.downloadButton"),
        false,
        () => {
          shell.openExternal(data.darwindownload);
        },
      );
    } else {
      settingsUpdateButtonStatus(
        Lang.queryJS("settings.updates.downloadingButton"),
        true,
      );
    }
  } else {
    settingsUpdateTitle.innerHTML = Lang.queryJS(
      "settings.updates.latestVersionTitle",
    );
    settingsUpdateChangelogCont.style.display = "none";
    populateVersionInformation(
      getVersion(),
      settingsUpdateVersionValue,
      settingsUpdateVersionTitle,
      settingsUpdateVersionCheck,
    );
    settingsUpdateButtonStatus(
      Lang.queryJS("settings.updates.checkForUpdatesButton"),
      false,
      () => {
        if (!isDev) {
          // TODO: Replace with Tauri IPC once the Rust command/event exists.
          // ipcRenderer.send("autoUpdateAction", "checkForUpdate");
          settingsUpdateButtonStatus(
            Lang.queryJS("settings.updates.checkingForUpdatesButton"),
            true,
          );
        }
      },
    );
  }
}

/**
 * Prepare update tab for display.
 *
 * @param {Object} data The update data.
 */
function prepareUpdateTab(data = null) {
  populateSettingsUpdateInformation(data);
}

/**
 * Settings preparation functions.
 */

/**
 * Prepare the entire settings UI.
 *
 * @param {boolean} first Whether or not it is the first load.
 */
async function prepareSettings(first = false) {
  if (first) {
    setupSettingsTabs();
    initSettingsValidators();
    prepareUpdateTab();
  } else {
    await prepareModsTab();
  }
  await initSettingsValues();
  prepareAccountsTab();
  await prepareJavaTab();
  prepareAboutTab();
}

export { prepareSettings, settingsNavItemListener, openSettingsAccountTab };
