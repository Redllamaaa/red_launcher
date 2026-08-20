/**
 * AuthManager
 *
 * This module abstracts Microsoft authentication procedures.
 * Authentication results are processed and stored in the ConfigManager.
 *
 * @module authmanager
 */

// Requirements
import ConfigManager from "./configmanager";
import { LoggerUtil } from "./loggerutil.js";
import { RestResponseStatus } from "helios-core/common";
import { MicrosoftAuth, MicrosoftErrorCode } from "helios-core/microsoft";
import { AZURE_CLIENT_ID } from "./ipcconstants";
import Lang from "./langloader";

const log = LoggerUtil.getLogger("AuthManager");

// Error messages

function microsoftErrorDisplayable(errorCode) {
  switch (errorCode) {
    case MicrosoftErrorCode.NO_PROFILE:
      return {
        title: Lang.queryJS("auth.microsoft.error.noProfileTitle"),
        desc: Lang.queryJS("auth.microsoft.error.noProfileDesc"),
      };

    case MicrosoftErrorCode.NO_XBOX_ACCOUNT:
      return {
        title: Lang.queryJS("auth.microsoft.error.noXboxAccountTitle"),
        desc: Lang.queryJS("auth.microsoft.error.noXboxAccountDesc"),
      };

    case MicrosoftErrorCode.XBL_BANNED:
      return {
        title: Lang.queryJS("auth.microsoft.error.xblBannedTitle"),
        desc: Lang.queryJS("auth.microsoft.error.xblBannedDesc"),
      };

    case MicrosoftErrorCode.UNDER_18:
      return {
        title: Lang.queryJS("auth.microsoft.error.under18Title"),
        desc: Lang.queryJS("auth.microsoft.error.under18Desc"),
      };

    case MicrosoftErrorCode.UNKNOWN:
      return {
        title: Lang.queryJS("auth.microsoft.error.unknownTitle"),
        desc: Lang.queryJS("auth.microsoft.error.unknownDesc"),
      };

    default:
      return {
        title: Lang.queryJS("auth.microsoft.error.unknownTitle"),
        desc: Lang.queryJS("auth.microsoft.error.unknownDesc"),
      };
  }
}

// Authentication modes
const AUTH_MODE = {
  FULL: 0,
  MS_REFRESH: 1,
  MC_REFRESH: 2,
};

/**
 * Perform the full Microsoft authentication flow.
 *
 * AUTH_MODE.FULL = Full authorization for a new account.
 * AUTH_MODE.MS_REFRESH = Refresh authorization.
 * AUTH_MODE.MC_REFRESH = Refresh the Minecraft token using the existing
 * Microsoft access token.
 *
 * @param {string} entryCode Auth code, refresh token, or Microsoft access token.
 * @param {number} authMode Authentication mode.
 * @returns {Promise<Object>} Authentication data.
 */
async function fullMicrosoftAuthFlow(entryCode, authMode) {
  try {
    let accessTokenRaw;
    let accessToken;

    if (authMode !== AUTH_MODE.MC_REFRESH) {
      const accessTokenResponse = await MicrosoftAuth.getAccessToken(
        entryCode,
        authMode === AUTH_MODE.MS_REFRESH,
        AZURE_CLIENT_ID,
      );

      if (accessTokenResponse.responseStatus === RestResponseStatus.ERROR) {
        return Promise.reject(
          microsoftErrorDisplayable(accessTokenResponse.microsoftErrorCode),
        );
      }

      accessToken = accessTokenResponse.data;
      accessTokenRaw = accessToken.access_token;
    } else {
      accessTokenRaw = entryCode;
    }

    const xblResponse = await MicrosoftAuth.getXBLToken(accessTokenRaw);

    if (xblResponse.responseStatus === RestResponseStatus.ERROR) {
      return Promise.reject(
        microsoftErrorDisplayable(xblResponse.microsoftErrorCode),
      );
    }

    const xstsResponse = await MicrosoftAuth.getXSTSToken(xblResponse.data);

    if (xstsResponse.responseStatus === RestResponseStatus.ERROR) {
      return Promise.reject(
        microsoftErrorDisplayable(xstsResponse.microsoftErrorCode),
      );
    }

    const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(
      xstsResponse.data,
    );

    if (mcTokenResponse.responseStatus === RestResponseStatus.ERROR) {
      return Promise.reject(
        microsoftErrorDisplayable(mcTokenResponse.microsoftErrorCode),
      );
    }

    const mcProfileResponse = await MicrosoftAuth.getMCProfile(
      mcTokenResponse.data.access_token,
    );

    if (mcProfileResponse.responseStatus === RestResponseStatus.ERROR) {
      return Promise.reject(
        microsoftErrorDisplayable(mcProfileResponse.microsoftErrorCode),
      );
    }

    return {
      accessToken,
      accessTokenRaw,
      xbl: xblResponse.data,
      xsts: xstsResponse.data,
      mcToken: mcTokenResponse.data,
      mcProfile: mcProfileResponse.data,
    };
  } catch (err) {
    log.error(err);

    return Promise.reject(
      microsoftErrorDisplayable(MicrosoftErrorCode.UNKNOWN),
    );
  }
}

/**
 * Calculate the expiry date.
 * Advance the expiry time by 10 seconds to reduce the likelihood
 * of working with an expired token.
 *
 * @param {number} nowMs Current time in milliseconds.
 * @param {number} expiresInS Expiration time in seconds.
 * @returns {number} Expiration timestamp.
 */
function calculateExpiryDate(nowMs, expiresInS) {
  return nowMs + (expiresInS - 10) * 1000;
}

/**
 * Add a Microsoft account.
 *
 * @param {string} authCode The authentication code obtained from Microsoft.
 * @returns {Promise<Object>} The authenticated account object.
 */
exports.addMicrosoftAccount = async function (authCode) {
  const fullAuth = await fullMicrosoftAuthFlow(authCode, AUTH_MODE.FULL);

  const now = new Date().getTime();

  const ret = ConfigManager.addMicrosoftAuthAccount(
    fullAuth.mcProfile.id,
    fullAuth.mcToken.access_token,
    fullAuth.mcProfile.name,
    calculateExpiryDate(now, fullAuth.mcToken.expires_in),
    fullAuth.accessToken.access_token,
    fullAuth.accessToken.refresh_token,
    calculateExpiryDate(now, fullAuth.accessToken.expires_in),
  );

  ConfigManager.save();

  return ret;
};

/**
 * Remove a Microsoft account.
 *
 * @param {string} uuid The UUID of the account to remove.
 * @returns {Promise<void>} Resolves when the account has been removed.
 */
exports.removeMicrosoftAccount = async function (uuid) {
  try {
    ConfigManager.removeAuthAccount(uuid);
    ConfigManager.save();
  } catch (err) {
    log.error("Error while removing account", err);
    return Promise.reject(err);
  }
};

/**
 * Validate the selected Microsoft account.
 *
 * If the Minecraft access token has expired, the Microsoft token will
 * be checked and refreshed as necessary.
 *
 * @returns {Promise<boolean>} True if the account is valid.
 */
async function validateSelectedMicrosoftAccount() {
  const current = ConfigManager.getSelectedAccount();
  const now = new Date().getTime();

  const mcExpiresAt = current.expiresAt;
  const mcExpired = now >= mcExpiresAt;

  if (!mcExpired) {
    return true;
  }

  // Minecraft token expired. Check Microsoft token.

  const msExpiresAt = current.microsoft.expires_at;
  const msExpired = now >= msExpiresAt;

  if (msExpired) {
    // Microsoft token expired. Perform a full refresh.
    try {
      const res = await fullMicrosoftAuthFlow(
        current.microsoft.refresh_token,
        AUTH_MODE.MS_REFRESH,
      );

      ConfigManager.updateMicrosoftAuthAccount(
        current.uuid,
        res.mcToken.access_token,
        res.accessToken.access_token,
        res.accessToken.refresh_token,
        calculateExpiryDate(now, res.accessToken.expires_in),
        calculateExpiryDate(now, res.mcToken.expires_in),
      );

      ConfigManager.save();

      return true;
    } catch (_err) {
      return false;
    }
  }

  // Only the Minecraft token expired. Reuse the existing Microsoft token.
  try {
    const res = await fullMicrosoftAuthFlow(
      current.microsoft.access_token,
      AUTH_MODE.MC_REFRESH,
    );

    ConfigManager.updateMicrosoftAuthAccount(
      current.uuid,
      res.mcToken.access_token,
      current.microsoft.access_token,
      current.microsoft.refresh_token,
      current.microsoft.expires_at,
      calculateExpiryDate(now, res.mcToken.expires_in),
    );

    ConfigManager.save();

    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Validate the selected authentication account.
 *
 * @returns {Promise<boolean>} True if the account is valid.
 */
exports.validateSelected = async function () {
  return await validateSelectedMicrosoftAccount();
};
