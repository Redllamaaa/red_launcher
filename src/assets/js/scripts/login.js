/**
 * Script for login.ejs
 */
import { ready } from "./bootstrap.js";
await ready();

import { VIEWS } from "./views.js";
import {
  setOverlayContent,
  setOverlayHandler,
  toggleOverlay,
} from "./overlay.js";
import $ from "jquery";
import { updateSelectedAccount } from "./landing.js";

// Login Elements
const loginCancelContainer = document.getElementById("loginCancelContainer");
const loginCancelButton = document.getElementById("loginCancelButton");
const checkmarkContainer = document.getElementById("checkmarkContainer");
const loginRememberOption = document.getElementById("loginRememberOption");
const loginButton = document.getElementById("loginButton");
const loginForm = document.getElementById("loginForm");

/**
 * Enable or disable the login button.
 *
 * @param {boolean} v True to enable, false to disable.
 */
function loginDisabled(v) {
  if (loginButton.disabled !== v) {
    loginButton.disabled = v;
  }
}

/**
 * Enable or disable loading elements.
 *
 * @param {boolean} v True to enable, false to disable.
 */
function loginLoading(v) {
  if (v) {
    loginButton.setAttribute("loading", v);
    loginButton.innerHTML = loginButton.innerHTML.replace(
      Lang.queryJS("login.login"),
      Lang.queryJS("login.loggingIn"),
    );
  } else {
    loginButton.removeAttribute("loading");
    loginButton.innerHTML = loginButton.innerHTML.replace(
      Lang.queryJS("login.loggingIn"),
      Lang.queryJS("login.login"),
    );
  }
}

/**
 * Enable or disable login form controls.
 *
 * @param {boolean} v True to enable, false to disable.
 */
function formDisabled(v) {
  loginDisabled(v);
  loginCancelButton.disabled = v;
  if (v) {
    checkmarkContainer.setAttribute("disabled", v);
  } else {
    checkmarkContainer.removeAttribute("disabled");
  }
  loginRememberOption.disabled = v;
}

let loginViewOnSuccess = VIEWS.landing;
let loginViewOnCancel = VIEWS.settings;
let loginViewCancelHandler;

function loginCancelEnabled(val) {
  if (val) {
    $(loginCancelContainer).show();
  } else {
    $(loginCancelContainer).hide();
  }
}

loginCancelButton.onclick = (e) => {
  switchView(getCurrentView(), loginViewOnCancel, 500, 500, () => {
    loginCancelEnabled(false);
    if (loginViewCancelHandler != null) {
      loginViewCancelHandler();
      loginViewCancelHandler = null;
    }
  });
};

// Disable default form behavior.
loginForm.onsubmit = () => {
  return false;
};

// Bind login button behavior.
loginButton.addEventListener("click", () => {
  formDisabled(true);
  loginLoading(true);

  AuthManager.addMicrosoftAccount()
    .then((value) => {
      updateSelectedAccount(value);
      loginButton.innerHTML = loginButton.innerHTML.replace(
        Lang.queryJS("login.loggingIn"),
        Lang.queryJS("login.success"),
      );
      $(".circle-loader").toggleClass("load-complete");
      $(".checkmark").toggle();
      setTimeout(() => {
        switchView(VIEWS.login, loginViewOnSuccess, 500, 500, async () => {
          if (loginViewOnSuccess === VIEWS.settings) {
            await prepareSettings();
          }
          loginViewOnSuccess = VIEWS.landing;
          loginCancelEnabled(false);
          loginViewCancelHandler = null;
          $(".circle-loader").toggleClass("load-complete");
          $(".checkmark").toggle();
          loginLoading(false);
          loginButton.innerHTML = loginButton.innerHTML.replace(
            Lang.queryJS("login.success"),
            Lang.queryJS("login.login"),
          );
          formDisabled(false);
        });
      }, 1000);
    })
    .catch((displayableError) => {
      loginLoading(false);

      let actualDisplayableError;
      if (isDisplayableError(displayableError)) {
        msftLoginLogger.error("Error while logging in.", displayableError);
        actualDisplayableError = displayableError;
      } else {
        msftLoginLogger.error(
          "Unhandled error during login.",
          displayableError,
        );
        actualDisplayableError = Lang.queryJS("login.error.unknown");
      }

      setOverlayContent(
        actualDisplayableError.title,
        actualDisplayableError.desc,
        Lang.queryJS("login.tryAgain"),
      );
      setOverlayHandler(() => {
        formDisabled(false);
        toggleOverlay(false);
      });
      toggleOverlay(true);
    });
});
