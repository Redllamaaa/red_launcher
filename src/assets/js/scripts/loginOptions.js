import { ready } from "./bootstrap.js";
import { VIEWS } from "./views.js";
import $ from "jquery";
import { getCurrentView, switchView } from "./viewstate.js";
import { open } from "@tauri-apps/plugin-shell";
import { toggleAccountSelection } from "./overlay.js";
import { updateSelectedAccount } from "./landing.js";
import * as AuthManager from "../authmanager.js";

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
        const { account } = await AuthManager.addMicrosoftAccount((dc) => {
          alert(dc.message);
        });

        updateSelectedAccount(account);

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
