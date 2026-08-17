/**
 * Core UI functions are initialized in this file. This prevents
 * unexpected errors from breaking the core features. Specifically,
 * actions in this file should not require the usage of any internal
 * modules, excluding dependencies.
 */
// Tauri
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-shell";

// Requirements
import $ from "jquery";
import isDev from "../isdev.js";
import { VIEWS } from "./views.js";

import Lang from "../langloader.js";
import * as ConfigManager from "../configmanager.js";

import { ready } from "./bootstrap.js";
await ready();

import { LoggerUtil } from "./loggerutil.js";

const loggerUICore = LoggerUtil.getLogger("UICore");
const loggerAutoUpdater = LoggerUtil.getLogger("AutoUpdater");

function copy(value) {
  navigator.clipboard.writeText(value);
}

// Disable eval function.
window.eval = globalThis.eval = function () {
  throw new Error("Sorry, this app does not support window.eval().");
};

// Disable zoom, needed for darwin.
document.body.style.zoom = 1;
document.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false },
);

// Initialize auto updates in production environments.
let updateCheckListener;
if (!isDev) {
  ipcRenderer.on("autoUpdateNotification", (event, arg, info) => {
    switch (arg) {
      case "checking-for-update":
        loggerAutoUpdater.info("Checking for update..");
        settingsUpdateButtonStatus(
          Lang.queryJS("uicore.autoUpdate.checkingForUpdateButton"),
          true,
        );
        break;
      case "update-available":
        loggerAutoUpdater.info("New update available", info.version);

        if (process.platform === "darwin") {
          info.darwindownload = `https://github.com/Redllamaaa/tsmplauncher/releases/download/v${info.version}/TSMP Launcher-setup-${info.version}${process.arch === "arm64" ? "-arm64" : "-x64"}.dmg`;
          showUpdateUI(info);
        }

        populateSettingsUpdateInformation(info);
        break;
      case "update-downloaded":
        loggerAutoUpdater.info(
          "Update " + info.version + " ready to be installed.",
        );
        settingsUpdateButtonStatus(
          Lang.queryJS("uicore.autoUpdate.installNowButton"),
          false,
          () => {
            if (!isDev) {
              // TODO: Replace with Tauri IPC once the Rust command/event exists.
              // ipcRenderer.send("autoUpdateAction", "installUpdateNow");
            }
          },
        );
        showUpdateUI(info);
        break;
      case "update-not-available":
        loggerAutoUpdater.info("No new update found.");
        settingsUpdateButtonStatus(
          Lang.queryJS("uicore.autoUpdate.checkForUpdatesButton"),
        );
        break;
      case "ready":
        updateCheckListener = setInterval(() => {
          // TODO: Replace with Tauri IPC once the Rust command/event exists.
          // ipcRenderer.send("autoUpdateAction", "checkForUpdate");
        }, 1800000);
        // ipcRenderer.send("autoUpdateAction", "checkForUpdate");
        break;
      case "realerror":
        if (info != null && info.code != null) {
          if (info.code === "ERR_UPDATER_INVALID_RELEASE_FEED") {
            loggerAutoUpdater.info("No suitable releases found.");
          } else if (info.code === "ERR_XML_MISSED_ELEMENT") {
            loggerAutoUpdater.info("No releases found.");
          } else {
            loggerAutoUpdater.error("Error during update check..", info);
            loggerAutoUpdater.debug("Error Code:", info.code);
          }
        }
        break;
      default:
        loggerAutoUpdater.info("Unknown argument", arg);
        break;
    }
  });
}

/**
 * Send a notification to the main process changing the value of
 * allowPrerelease. If we are running a prerelease version, then
 * this will always be set to true, regardless of the current value
 * of val.
 *
 * @param {boolean} val The new allow prerelease value.
 */
function changeAllowPrerelease(val) {
  // TODO: Replace with Tauri IPC once the Rust command/event exists.
  // ipcRenderer.send("autoUpdateAction", "allowPrereleaseChange", val);
}

function showUpdateUI(info) {
  //TODO Make this message a bit more informative `${info.version}`
  document.getElementById("image_seal_container").setAttribute("update", true);
  document.getElementById("image_seal_container").onclick = () => {
    /*setOverlayContent('Update Available', 'A new update for the launcher is available. Would you like to install now?', 'Install', 'Later')
        setOverlayHandler(() => {
            if(!isDev){
                ipcRenderer.send('autoUpdateAction', 'installUpdateNow')
            } else {
                console.error('Cannot install updates in development environment.')
                toggleOverlay(false)
            }
        })
        setDismissHandler(() => {
            toggleOverlay(false)
        })
        toggleOverlay(true, true)*/
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
      settingsNavItemListener(
        document.getElementById("settingsNavUpdate"),
        false,
      );
    });
  };
}

/* jQuery Example
$(function(){
    loggerUICore.info('UICore Initialized');
})*/

document.addEventListener(
  "readystatechange",
  function () {
    if (document.readyState === "interactive") {
      loggerUICore.info("UICore Initializing..");

      // Bind close button.
      Array.from(document.getElementsByClassName("fCb")).map((val) => {
        val.addEventListener("click", (e) => {
          const window = remote.getCurrentWindow();
          window.close();
        });
      });

      // Bind restore down button.
      Array.from(document.getElementsByClassName("fRb")).map((val) => {
        val.addEventListener("click", (e) => {
          const window = remote.getCurrentWindow();
          if (window.isMaximized()) {
            window.unmaximize();
          } else {
            window.maximize();
          }
          document.activeElement.blur();
        });
      });

      // Bind minimize button.
      Array.from(document.getElementsByClassName("fMb")).map((val) => {
        val.addEventListener("click", (e) => {
          const window = remote.getCurrentWindow();
          window.minimize();
          document.activeElement.blur();
        });
      });

      // Remove focus from social media buttons once they're clicked.
      Array.from(document.getElementsByClassName("mediaURL")).map((val) => {
        val.addEventListener("click", (e) => {
          document.activeElement.blur();
        });
      });
    } else if (document.readyState === "complete") {
      //266.01
      //170.8
      //53.21
      // Bind progress bar length to length of bot wrapper
      //const targetWidth = document.getElementById("launch_content").getBoundingClientRect().width
      //const targetWidth2 = document.getElementById("server_selection").getBoundingClientRect().width
      //const targetWidth3 = document.getElementById("launch_button").getBoundingClientRect().width

      document.getElementById("launch_details").style.maxWidth = 266.01;
      document.getElementById("launch_progress").style.width = 170.8;
      document.getElementById("launch_details_right").style.maxWidth = 170.8;
      document.getElementById("launch_progress_label").style.width = 53.21;
    }
  },
  false,
);

/**
 * Open web links in the user's default browser.
 */
$(document).on("click", 'a[href^="http"]', function (event) {
  event.preventDefault();
  shell.openExternal(this.href);
});

/**
 * Opens DevTools window if you hold (ctrl + shift + i).
 * This will crash the program if you are using multiple
 * DevTools, for example the chrome debugger in VS Code.
 */
document.addEventListener("keydown", function (e) {
  if ((e.key === "I" || e.key === "i") && e.ctrlKey && e.shiftKey) {
    let window = remote.getCurrentWindow();
    window.toggleDevTools();
  }
});

export { LoggerUtil, loggerUICore, loggerAutoUpdater };
