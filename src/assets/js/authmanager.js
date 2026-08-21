/**
 * AuthManager
 *
 * Handles Microsoft authentication and keeps the authenticated
 * account stored in ConfigManager.
 *
 * @module authmanager
 */

import { invoke } from "@tauri-apps/api/core";
import * as ConfigManager from "./configmanager.js";
import { LoggerUtil } from "./scripts/loggerutil.js";
import { AZURE_CLIENT_ID } from "./ipcconstants.js";

const log = LoggerUtil.getLogger("AuthManager");

/**
 * Calculate a token expiry timestamp.
 *
 * We subtract 10 seconds so callers don't accidentally try to
 * use a token right at the expiration boundary.
 *
 * @param {number} nowMs
 * @param {number} expiresInS
 * @returns {number}
 */
function calculateExpiryDate(nowMs, expiresInS) {
  return nowMs + Math.max(0, Number(expiresInS) - 10) * 1000;
}

/**
 * Store an authenticated Microsoft account.
 *
 * @param {Object} auth
 * @returns {Object}
 */
async function storeMicrosoftAuth(auth) {
  const now = Date.now();
  const msExpiresAt = calculateExpiryDate(now, auth.ms_expires_in);
  const mcExpiresAt = calculateExpiryDate(now, auth.mc_expires_in);

  // Sensitive tokens go to the OS keyring via Rust.
  await invoke("store_account_tokens", {
    uuid: auth.mc_uuid,
    tokens: {
      ms_access_token: auth.ms_access_token,
      ms_refresh_token: auth.ms_refresh_token,
      ms_expires_at: new Date(msExpiresAt).toISOString(),
      mc_access_token: auth.mc_access_token,
      mc_expires_at: new Date(mcExpiresAt).toISOString(),
    },
  });

  // Non-sensitive metadata stays in the existing JS config as before.
  const account = ConfigManager.addMicrosoftAuthAccount(
    auth.mc_uuid,
    auth.mc_username,
    mcExpiresAt,
  );

  ConfigManager.save();
  return account;
}

/**
 * Start the Microsoft device-code authentication flow.
 *
 * @returns {Promise<Object>}
 */
async function fullMicrosoftAuthFlow() {
  try {
    const deviceCode = await invoke("start_microsoft_device_code", {
      clientId: AZURE_CLIENT_ID,
    });

    /*
     * Start polling only after the device code has been returned.
     *
     * This allows the UI to display:
     *
     *   deviceCode.user_code
     *   deviceCode.verification_uri
     *   deviceCode.message
     *
     * while Rust waits for the user to finish authentication.
     */
    const authPromise = invoke("poll_microsoft_device_code", {
      clientId: AZURE_CLIENT_ID,
      deviceCode: deviceCode.device_code,
      interval: deviceCode.interval,
    });

    return {
      deviceCode,
      authPromise,
    };
  } catch (err) {
    log.error("Failed to start Microsoft authentication.", err);

    throw err;
  }
}

/**
 * Add a Microsoft account.
 *
 * @param {(deviceCode: Object) => void} [onDeviceCode] Optional callback
 * invoked as soon as the device code is available, so the caller can
 * display deviceCode.user_code / verification_uri / message to the user
 * while polling continues in the background.
 * @returns {Promise<Object>}
 */
export async function addMicrosoftAccount(onDeviceCode) {
  try {
    const { deviceCode, authPromise } = await fullMicrosoftAuthFlow();

    if (typeof onDeviceCode === "function") {
      onDeviceCode(deviceCode);
    }

    const auth = await authPromise;

    const account = storeMicrosoftAuth(auth);

    return {
      account,
      deviceCode,
    };
  } catch (err) {
    log.error("Microsoft authentication failed.", err);

    throw err;
  }
}

/**
 * Refresh a Microsoft account using its stored
 * Microsoft refresh token.
 *
 * @param {Object} current
 * @returns {Promise<Object>}
 */
async function refreshMicrosoftAccount(current) {
  let stored;
  try {
    stored = await invoke("get_account_tokens", { uuid: current.uuid });
  } catch (err) {
    log.error("Failed to read stored tokens for account.", err);
    return false;
  }

  const refreshToken = stored?.ms_refresh_token;

  if (!refreshToken) {
    log.warn("Cannot refresh Microsoft account: no refresh token.");
    return false;
  }

  try {
    const auth = await invoke("refresh_microsoft_account", {
      clientId: AZURE_CLIENT_ID,
      refreshToken,
    });

    const account = storeMicrosoftAuth(auth);

    log.info(
      `Successfully refreshed Microsoft account ${account.uuid ?? current.uuid}.`,
    );

    return account;
  } catch (err) {
    log.error("Failed to refresh Microsoft account.", err);
    return false;
  }
}

/**
 * Remove a Microsoft account.
 *
 * @param {string} uuid
 * @returns {Promise<void>}
 */
export async function removeMicrosoftAccount(uuid) {
  try {
    await invoke("logout_microsoft", { uuid }); // wipes keyring entry
    ConfigManager.removeAuthAccount(uuid); // wipes JS metadata
    ConfigManager.save();
  } catch (err) {
    log.error("Error while removing account.", err);
    throw err;
  }
}

/**
 * Validate the currently selected Microsoft account.
 *
 * If the Minecraft token has expired, automatically attempt
 * to refresh the account using the Microsoft refresh token.
 *
 * @returns {Promise<boolean>}
 */
async function validateSelectedMicrosoftAccount() {
  const current = ConfigManager.getSelectedAccount();

  if (!current) {
    return false;
  }

  const now = Date.now();

  /*
   * Minecraft token is still valid.
   */
  if (typeof current.expiresAt === "number" && now < current.expiresAt) {
    return true;
  }

  /*
   * Minecraft token expired.
   *
   * Attempt a transparent Microsoft refresh.
   */
  log.info(
    "Minecraft access token expired. Attempting Microsoft token refresh.",
  );

  const refreshed = await refreshMicrosoftAccount(current);

  if (!refreshed) {
    log.warn("Unable to refresh Microsoft account.");

    return false;
  }

  return true;
}

/**
 * Validate the selected authentication account.
 *
 * @returns {Promise<boolean>}
 */
export async function validateSelected() {
  return validateSelectedMicrosoftAccount();
}
