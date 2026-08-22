use reqwest::Client;
use serde::{ Deserialize, Serialize };
use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use crate::auth_error::AuthError;

/// Tracks device codes the frontend has asked us to abandon.
///
/// A device_code is only ever inserted here when the user cancels —
/// successful/expired/declined flows never touch this set, so there's
/// nothing to clean up in the common case. `take_cancelled` removes the
/// entry on read since a device_code is single-use.
///
/// Registered as managed state in `lib.rs` via `.manage(CancelledDeviceCodes::default())`.
#[derive(Default)]
pub struct CancelledDeviceCodes(Mutex<HashSet<String>>);

impl CancelledDeviceCodes {
    fn cancel(&self, device_code: &str) {
        self.0.lock().unwrap().insert(device_code.to_string());
    }

    fn take_cancelled(&self, device_code: &str) -> bool {
        self.0.lock().unwrap().remove(device_code)
    }
}

/// Ask an in-progress `poll_microsoft_device_code` call to stop.
///
/// This doesn't interrupt an in-flight HTTP request to Microsoft, but the
/// poll loop checks for cancellation before every request and at ~1s
/// granularity while it would otherwise be sleeping, so the caller sees
/// `AuthError::Cancelled` shortly after this is called.
#[tauri::command]
pub fn cancel_microsoft_device_code(
    state: tauri::State<CancelledDeviceCodes>,
    device_code: String
) {
    state.cancel(&device_code);
}

/// Sleep for `duration`, but wake early (and return early) if `device_code`
/// is cancelled. Checked in ~1s steps rather than once at the end so a
/// cancellation lands quickly even when the poll interval is long.
async fn sleep_or_cancel(
    duration: Duration,
    device_code: &str,
    cancel_state: &CancelledDeviceCodes
) -> Result<(), AuthError> {
    let step = Duration::from_secs(1);
    let mut remaining = duration;

    while remaining > Duration::ZERO {
        if cancel_state.take_cancelled(device_code) {
            return Err(AuthError::Cancelled);
        }

        let sleep_for = remaining.min(step);
        tokio::time::sleep(sleep_for).await;
        remaining = remaining.saturating_sub(sleep_for);
    }

    if cancel_state.take_cancelled(device_code) {
        return Err(AuthError::Cancelled);
    }

    Ok(())
}

const MS_DEVICE_CODE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";

const MS_OAUTH_TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

const XBL_AUTH: &str = "https://user.auth.xboxlive.com/user/authenticate";

const XSTS_AUTH: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";

const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";

const MC_ENTITLEMENTS: &str = "https://api.minecraftservices.com/entitlements/mcstore";

const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    message: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Debug, Serialize)]
pub struct DeviceCodeInfo {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub message: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Serialize)]
pub struct MicrosoftAuthResult {
    pub ms_access_token: String,
    pub ms_refresh_token: String,
    pub ms_expires_in: u64,

    pub mc_access_token: String,
    pub mc_expires_in: u64,

    pub mc_uuid: String,
    pub mc_username: String,
}

#[derive(Debug, Deserialize)]
struct MsTokenResponse {
    access_token: String,

    #[serde(default)]
    refresh_token: Option<String>,

    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct XblResponse {
    #[serde(rename = "Token")]
    token: String,

    #[serde(rename = "DisplayClaims")]
    display_claims: XblDisplayClaims,
}

#[derive(Debug, Deserialize)]
struct XblDisplayClaims {
    xui: Vec<XblUserInfo>,
}

#[derive(Debug, Deserialize)]
struct XblUserInfo {
    uhs: String,
}

#[derive(Debug, Deserialize)]
struct McTokenResponse {
    access_token: String,
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct McProfileResponse {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct McEntitlementsResponse {
    items: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct OAuthErrorResponse {
    error: String,

    #[serde(default)]
    error_description: Option<String>,
}

/**
 * Start the Microsoft device-code authentication flow.
 */
#[tauri::command]
pub async fn start_microsoft_device_code(client_id: String) -> Result<DeviceCodeInfo, AuthError> {
    let client = Client::new();

    let response = client
        .post(MS_DEVICE_CODE)
        .form(
            &[
                ("client_id", client_id.as_str()),
                ("scope", "XboxLive.signin offline_access"),
            ]
        )
        .send().await?;

    let status = response.status();

    let text = response.text().await.map_err(|e| AuthError::Network(e.to_string()))?;

    if !status.is_success() {
        return Err(AuthError::Http {
            status: status.as_u16(),
            body: text,
        });
    }

    let device_code: DeviceCodeResponse = serde_json
        ::from_str(&text)
        .map_err(|e| AuthError::Parse(format!("{e} — {text}")))?;

    Ok(DeviceCodeInfo {
        device_code: device_code.device_code,
        user_code: device_code.user_code,
        verification_uri: device_code.verification_uri,
        message: device_code.message,
        expires_in: device_code.expires_in,
        interval: device_code.interval,
    })
}

/**
 * Poll Microsoft until the user completes authentication.
 *
 * Once Microsoft authentication succeeds, this automatically performs:
 *
 * Microsoft
 *   -> Xbox Live
 *   -> XSTS
 *   -> Minecraft
 *   -> ownership
 *   -> profile
 */
#[tauri::command]
pub async fn poll_microsoft_device_code(
    client_id: String,
    device_code: String,
    interval: u64,
    cancel_state: tauri::State<'_, CancelledDeviceCodes>
) -> Result<MicrosoftAuthResult, AuthError> {
    let client = Client::new();

    let wait_secs = interval.max(5);

    loop {
        if cancel_state.take_cancelled(&device_code) {
            return Err(AuthError::Cancelled);
        }

        let response = client
            .post(MS_OAUTH_TOKEN)
            .form(
                &[
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                    ("client_id", client_id.as_str()),
                    ("device_code", device_code.as_str()),
                ]
            )
            .send().await?;

        let status = response.status();

        let text = response.text().await.map_err(|e| AuthError::Network(e.to_string()))?;

        if status.is_success() {
            let ms_token: MsTokenResponse = serde_json
                ::from_str(&text)
                .map_err(|e| AuthError::Parse(format!("{e} — {text}")))?;

            let refresh_token = ms_token.refresh_token.ok_or(AuthError::NoRefreshToken)?;

            return complete_minecraft_chain(
                client,
                ms_token.access_token,
                refresh_token,
                ms_token.expires_in
            ).await;
        }

        let error: OAuthErrorResponse = serde_json
            ::from_str(&text)
            .map_err(|e| AuthError::Parse(format!("{e} — {text}")))?;

        match error.error.as_str() {
            "authorization_pending" => {
                sleep_or_cancel(Duration::from_secs(wait_secs), &device_code, &cancel_state).await?;
            }

            "slow_down" => {
                sleep_or_cancel(
                    Duration::from_secs(wait_secs + 5),
                    &device_code,
                    &cancel_state
                ).await?;
            }

            "authorization_declined" => {
                return Err(AuthError::Declined);
            }

            "expired_token" => {
                return Err(AuthError::Expired);
            }

            "bad_verification_code" => {
                return Err(AuthError::InvalidDeviceCode);
            }

            other => {
                return Err(AuthError::Other(format!("{} — {:?}", other, error.error_description)));
            }
        }
    }
}

/**
 * Refresh an existing Microsoft authentication session.
 *
 * The Microsoft refresh token is exchanged for a new Microsoft
 * access token, then the normal Xbox Live -> XSTS -> Minecraft
 * chain is executed again.
 */
#[tauri::command]
pub async fn refresh_microsoft_account(
    client_id: String,
    refresh_token: String
) -> Result<MicrosoftAuthResult, AuthError> {
    let client = Client::new();

    let response = client
        .post(MS_OAUTH_TOKEN)
        .form(
            &[
                ("client_id", client_id.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token.as_str()),
                ("scope", "XboxLive.signin offline_access"),
            ]
        )
        .send().await?;

    let status = response.status();

    let text = response.text().await.map_err(|e| AuthError::Network(e.to_string()))?;

    if !status.is_success() {
        if let Ok(error) = serde_json::from_str::<OAuthErrorResponse>(&text) {
            return Err(
                AuthError::Other(
                    format!(
                        "Microsoft refresh failed: {} — {:?}",
                        error.error,
                        error.error_description
                    )
                )
            );
        }

        return Err(AuthError::Http {
            status: status.as_u16(),
            body: text,
        });
    }

    let ms_token: MsTokenResponse = serde_json
        ::from_str(&text)
        .map_err(|e| AuthError::Parse(format!("{e} — {text}")))?;

    /*
     * Microsoft may rotate the refresh token.
     *
     * If a new one is supplied, use it.
     * Otherwise retain the existing refresh token.
     */
    let new_refresh_token = ms_token.refresh_token.unwrap_or(refresh_token);

    complete_minecraft_chain(
        client,
        ms_token.access_token,
        new_refresh_token,
        ms_token.expires_in
    ).await
}

/**
 * Microsoft -> Xbox Live -> XSTS -> Minecraft.
 */
async fn complete_minecraft_chain(
    client: Client,
    ms_access_token: String,
    ms_refresh_token: String,
    ms_expires_in: u64
) -> Result<MicrosoftAuthResult, AuthError> {
    /*
     * Xbox Live authentication.
     */
    let xbl_body =
        serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={}", ms_access_token)
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });

    let xbl_response = client.post(XBL_AUTH).json(&xbl_body).send().await?;

    let xbl_status = xbl_response.status();

    let xbl_text = xbl_response.text().await.map_err(|e| AuthError::Network(e.to_string()))?;

    if !xbl_status.is_success() {
        return Err(AuthError::Http {
            status: xbl_status.as_u16(),
            body: xbl_text,
        });
    }

    let xbl: XblResponse = serde_json
        ::from_str(&xbl_text)
        .map_err(|e| AuthError::Parse(format!("{e} — {xbl_text}")))?;

    let uhs = xbl.display_claims.xui.first().ok_or(AuthError::NoUserHash)?.uhs.clone();

    /*
     * XSTS authentication.
     */
    let xsts_body =
        serde_json::json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [xbl.token]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });

    let xsts_response = client.post(XSTS_AUTH).json(&xsts_body).send().await?;

    let xsts_status = xsts_response.status();

    let xsts_text = xsts_response.text().await.map_err(|e| AuthError::Network(e.to_string()))?;

    if !xsts_status.is_success() {
        return Err(AuthError::Http {
            status: xsts_status.as_u16(),
            body: xsts_text,
        });
    }

    let xsts: XblResponse = serde_json
        ::from_str(&xsts_text)
        .map_err(|e| AuthError::Parse(format!("{e} — {xsts_text}")))?;

    /*
     * Minecraft authentication.
     */
    let minecraft_login_body =
        serde_json::json!({
        "identityToken": format!(
            "XBL3.0 x={};{}",
            uhs,
            xsts.token
        )
    });

    let mc_token_response = client.post(MC_LOGIN).json(&minecraft_login_body).send().await?;

    let mc_status = mc_token_response.status();

    let mc_token_text = mc_token_response
        .text().await
        .map_err(|e| AuthError::Network(e.to_string()))?;

    if !mc_status.is_success() {
        return Err(AuthError::Http {
            status: mc_status.as_u16(),
            body: mc_token_text,
        });
    }

    let mc_token: McTokenResponse = serde_json
        ::from_str(&mc_token_text)
        .map_err(|e| AuthError::Parse(format!("{e} — {mc_token_text}")))?;

    /*
     * Minecraft ownership.
     */
    let entitlements_response = client
        .get(MC_ENTITLEMENTS)
        .bearer_auth(&mc_token.access_token)
        .send().await?;

    let entitlements_status = entitlements_response.status();

    let entitlements_text = entitlements_response
        .text().await
        .map_err(|e| AuthError::Network(e.to_string()))?;

    if !entitlements_status.is_success() {
        return Err(AuthError::Http {
            status: entitlements_status.as_u16(),
            body: entitlements_text,
        });
    }

    let entitlements: McEntitlementsResponse = serde_json
        ::from_str(&entitlements_text)
        .map_err(|e| AuthError::Parse(format!("{e} — {entitlements_text}")))?;

    if entitlements.items.is_empty() {
        return Err(AuthError::NotEntitled);
    }

    /*
     * Minecraft profile.
     */
    let profile_response = client.get(MC_PROFILE).bearer_auth(&mc_token.access_token).send().await?;

    let profile_status = profile_response.status();

    let profile_text = profile_response
        .text().await
        .map_err(|e| AuthError::Network(e.to_string()))?;

    if !profile_status.is_success() {
        return Err(AuthError::Http {
            status: profile_status.as_u16(),
            body: profile_text,
        });
    }

    let mc_profile: McProfileResponse = serde_json
        ::from_str(&profile_text)
        .map_err(|e| AuthError::Parse(format!("{e} — {profile_text}")))?;

    Ok(MicrosoftAuthResult {
        ms_access_token,
        ms_refresh_token,
        ms_expires_in,

        mc_access_token: mc_token.access_token,
        mc_expires_in: mc_token.expires_in,

        mc_uuid: mc_profile.id,
        mc_username: mc_profile.name,
    })
}
