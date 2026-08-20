import { ready } from "./bootstrap.js";
import { VIEWS } from "./views.js";
import $ from "jquery";
import { getCurrentView, switchView } from "./viewstate.js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { AZURE_CLIENT_ID } from "../ipcconstants.js";
import * as ConfigManager from "../configmanager.js";
import { toggleAccountSelection } from "./overlay.js";

await ready();

const loginOptionsCancelContainer = document.getElementById(
  "loginOptionCancelContainer",
);
const loginOptionMicrosoft = document.getElementById("loginOptionMicrosoft");
const loginOptionsCancelButton = document.getElementById(
  "loginOptionCancelButton",
);

let loginOptionsCancellable = false;

import {
  getLoginOptionsViewOnLoginSuccess,
  getLoginOptionsViewOnLoginCancel,
  getLoginOptionsViewOnCancel,
  getLoginOptionsViewCancelHandler,
  setLoginOptionsViewCancelHandler,
} from "./loginOptionsState.js";

export function loginOptionsCancelEnabled(val) {
  if (val) {
    $(loginOptionsCancelContainer).show();
  } else {
    $(loginOptionsCancelContainer).hide();
  }
}

loginOptionMicrosoft.onclick = async () => {
  switchView(
    getCurrentView(),
    VIEWS.waiting,
    500,
    500,
    () => {},
    async () => {
      try {
        const dc = await invoke("start_microsoft_device_code", {
          clientId: AZURE_CLIENT_ID,
        });
        alert(dc.message);

        const result = await invoke("poll_microsoft_device_code", {
          clientId: AZURE_CLIENT_ID,
          deviceCode: dc.device_code,
          interval: dc.interval,
        });

        ConfigManager.addMicrosoftAuthAccount(
          result.mc_uuid,
          result.mc_access_token,
          result.mc_username,
          result.mc_expires_at,
          result.ms_access_token,
          result.ms_refresh_token,
          result.ms_expires_at,
        );
        ConfigManager.save();

        switchView(
          getCurrentView(),
          getLoginOptionsViewOnLoginSuccess(),
          500,
          500,
        );
      } catch (err) {
        console.error("Microsoft login failed:", err);
        switchView(
          getCurrentView(),
          getLoginOptionsViewOnLoginCancel(),
          500,
          500,
        );
      }
    },
  );
};

loginOptionsCancelButton.onclick = (e) => {
  switchView(getCurrentView(), getLoginOptionsViewOnCancel(), 500, 500, () => {
    const cancelHandler = getLoginOptionsViewCancelHandler();
    if (cancelHandler) {
      cancelHandler();
      setLoginOptionsViewCancelHandler(null);
    }
  });
};
