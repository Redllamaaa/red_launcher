import { ready } from "./bootstrap.js";
await ready();

import { VIEWS } from "./views.js";
import $ from "jquery";
import { getCurrentView, switchView } from "./viewstate.js";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { AZURE_CLIENT_ID } from "../ipcconstants.js";

const loginOptionsCancelContainer = document.getElementById(
  "loginOptionCancelContainer",
);
const loginOptionMicrosoft = document.getElementById("loginOptionMicrosoft");
const loginOptionMojang = document.getElementById("loginOptionMojang");
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

lloginOptionMicrosoft.onclick = async () => {
  switchView(getCurrentView(), VIEWS.waiting, 500, 500, async () => {
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

      console.log("Microsoft auth result:", result);

      // TODO: Save account in ConfigManager using result.ms_* and result.mc_*
      // ConfigManager.addMicrosoftAuthAccount(result);

      switchView(
        getCurrentView(),
        getLoginOptionsViewOnLoginSuccess(), // or wherever you go after login
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
  });
};

loginOptionMojang.onclick = (e) => {
  switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
    loginViewOnSuccess = getLoginOptionsViewOnLoginSuccess();
    loginViewOnCancel = getLoginOptionsViewOnLoginCancel();
    loginCancelEnabled(true);
  });
};

loginOptionsCancelButton.onclick = (e) => {
  switchView(getCurrentView(), getLoginOptionsViewOnCancel(), 500, 500, () => {
    // Clear login values (Mojang login)
    // No cleanup needed for Microsoft.
    loginUsername.value = "";
    loginPassword.value = "";
    if (getLoginOptionsViewCancelHandler() != null) {
      getLoginOptionsViewCancelHandler()();
      setLoginOptionsViewCancelHandler(null);
    }
  });
};
