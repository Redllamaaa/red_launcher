/**
 * Script for welcome.ejs
 */
import { ready } from "./bootstrap.js";
await ready();

import { VIEWS } from "./views.js";

document.getElementById("welcomeButton").addEventListener("click", (e) => {
  loginOptionsCancelEnabled(false); // False by default, be explicit.
  loginOptionsViewOnLoginSuccess = VIEWS.landing;
  loginOptionsViewOnLoginCancel = VIEWS.loginOptions;
  switchView(VIEWS.welcome, VIEWS.loginOptions);
});
