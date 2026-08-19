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

loginOptionMicrosoft.onclick = async (e) => {
  switchView(getCurrentView(), VIEWS.waiting, 500, 500, async () => {
    try {
      const port = 8931; // must match your Azure app registration's redirect URI port
      const redirectUri = `http://localhost:${port}/callback`;
      const clientId = AZURE_CLIENT_ID; // check this is imported — see below

      const authUrl =
        `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize` +
        `?client_id=${clientId}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_mode=query` +
        `&scope=${encodeURIComponent("XboxLive.signin offline_access")}`;

      // Kick off the redirect listener in Rust FIRST, before opening the browser,
      // so it's already waiting when the redirect comes back.
      const codePromise = invoke("await_microsoft_auth_code", { port });

      await open(authUrl); // opens in the system's default browser

      const code = await codePromise;
      console.log("Got Microsoft auth code:", code);

      // Stage 2 (token exchange) goes here once this logs successfully.
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
