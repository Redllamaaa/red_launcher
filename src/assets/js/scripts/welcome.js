/**
 * Script for welcome.ejs
 */
import { ready } from "./bootstrap.js";
import { VIEWS } from "./views.js";
import { switchView } from "./viewstate.js";
import { loginOptionsCancelEnabled } from "./loginOptions.js";
import {
  setLoginOptionsViewOnLoginSuccess,
  setLoginOptionsViewOnLoginCancel,
} from "./loginOptionsState.js";

await ready();

document.getElementById("welcomeButton").addEventListener("click", (e) => {
  loginOptionsCancelEnabled(false); // False by default, be explicit.
  setLoginOptionsViewOnLoginSuccess(VIEWS.landing);
  setLoginOptionsViewOnLoginCancel(VIEWS.loginOptions);
  switchView(VIEWS.welcome, VIEWS.loginOptions);
});
