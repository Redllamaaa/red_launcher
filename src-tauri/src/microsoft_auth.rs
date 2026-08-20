// TODO: Refactor file

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const MS_DEVICE_CODE: &str =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";

const MS_OAUTH_TOKEN: &str =
    "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

const XBL_AUTH: &str =
    "https://user.auth.xboxlive.com/user/authenticate";

const XSTS_AUTH: &str =
    "https://xsts.auth.xboxlive.com/xsts/authorize";

const MC_LOGIN: &str =
    "https://api.minecraftservices.com/authentication/login_with_xbox";

const MC_ENTITLEMENTS: &str =
    "https://api.minecraftservices.com/entitlements/mcstore";

const MC_PROFILE: &str =
    "https://api.minecraftservices.com/minecraft/profile";

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
pub async fn start_microsoft_device_code(
    client_id: String,
) -> Result<DeviceCodeInfo, String> {
    let client = Client::new();

    let response = client
        .post(MS_DEVICE_CODE)
        .form(&[
            ("client_id", client_id.as_str()),
            ("scope", "XboxLive.signin offline_access"),
        ])
        .send()
        .await
        .map_err(|e| format!("Device code request failed: {}", e))?;

    let status = response.status();

    let text = response
        .text()
        .await
        .map_err(|e| format!("Device code response read failed: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "Device code request failed with HTTP {}: {}",
            status, text
        ));
    }

    let device_code: DeviceCodeResponse =
        serde_json::from_str(&text)
            .map_err(|e| {
                format!(
                    "Device code response parse failed: {} — {}",
                    e, text
                )
            })?;

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
) -> Result<MicrosoftAuthResult, String> {
    let client = Client::new();

    let wait_secs = interval.max(5);

    loop {
        let response = client
            .post(MS_OAUTH_TOKEN)
            .form(&[
                (
                    "grant_type",
                    "urn:ietf:params:oauth:grant-type:device_code",
                ),
                ("client_id", client_id.as_str()),
                ("device_code", device_code.as_str()),
            ])
            .send()
            .await
            .map_err(|e| format!("Token poll request failed: {}", e))?;

        let status = response.status();

        let text = response
            .text()
            .await
            .map_err(|e| format!("Token poll response read failed: {}", e))?;

        if status.is_success() {
            let ms_token: MsTokenResponse =
                serde_json::from_str(&text)
                    .map_err(|e| {
                        format!(
                            "Microsoft token response parse failed: {} — {}",
                            e, text
                        )
                    })?;

            let refresh_token = ms_token
                .refresh_token
                .ok_or_else(|| {
                    "Microsoft did not return a refresh token.".to_string()
                })?;

            return complete_minecraft_chain(
                client,
                ms_token.access_token,
                refresh_token,
                ms_token.expires_in,
            )
            .await;
        }

        let error: OAuthErrorResponse =
            serde_json::from_str(&text)
                .map_err(|e| {
                    format!(
                        "Microsoft OAuth error response parse failed: {} — {}",
                        e, text
                    )
                })?;

        match error.error.as_str() {
            "authorization_pending" => {
                tokio::time::sleep(Duration::from_secs(wait_secs)).await;
            }

            "slow_down" => {
                tokio::time::sleep(Duration::from_secs(wait_secs + 5)).await;
            }

            "authorization_declined" => {
                return Err(
                    "Sign-in was cancelled or declined.".to_string()
                );
            }

            "expired_token" => {
                return Err(
                    "The sign-in code expired before completion. Please try again."
                        .to_string(),
                );
            }

            "bad_verification_code" => {
                return Err(
                    "Invalid device code. Please try again.".to_string()
                );
            }

            _ => {
                return Err(format!(
                    "Microsoft device-code authentication failed: {} — {:?}",
                    error.error,
                    error.error_description
                ));
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
    refresh_token: String,
) -> Result<MicrosoftAuthResult, String> {
    let client = Client::new();

    let response = client
        .post(MS_OAUTH_TOKEN)
        .form(&[
            ("client_id", client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("scope", "XboxLive.signin offline_access"),
        ])
        .send()
        .await
        .map_err(|e| format!("Microsoft refresh request failed: {}", e))?;

    let status = response.status();

    let text = response
        .text()
        .await
        .map_err(|e| format!("Microsoft refresh response read failed: {}", e))?;

    if !status.is_success() {
        let error = serde_json::from_str::<OAuthErrorResponse>(&text)
            .ok();

        if let Some(error) = error {
            return Err(format!(
                "Microsoft refresh failed: {} — {:?}",
                error.error,
                error.error_description
            ));
        }

        return Err(format!(
            "Microsoft refresh failed with HTTP {}: {}",
            status, text
        ));
    }

    let ms_token: MsTokenResponse =
        serde_json::from_str(&text)
            .map_err(|e| {
                format!(
                    "Microsoft refresh response parse failed: {} — {}",
                    e, text
                )
            })?;

    /*
     * Microsoft may rotate the refresh token.
     *
     * If a new one is supplied, use it.
     * Otherwise retain the existing refresh token.
     */
    let new_refresh_token = ms_token
        .refresh_token
        .unwrap_or(refresh_token);

    complete_minecraft_chain(
        client,
        ms_token.access_token,
        new_refresh_token,
        ms_token.expires_in,
    )
    .await
}

/**
 * Microsoft -> Xbox Live -> XSTS -> Minecraft.
 */
async fn complete_minecraft_chain(
    client: Client,
    ms_access_token: String,
    ms_refresh_token: String,
    ms_expires_in: u64,
) -> Result<MicrosoftAuthResult, String> {
    /*
     * Xbox Live authentication.
     */
    let xbl_body = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={}", ms_access_token)
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });

    let xbl_response = client
        .post(XBL_AUTH)
        .json(&xbl_body)
        .send()
        .await
        .map_err(|e| format!("Xbox Live request failed: {}", e))?;

    let xbl_status = xbl_response.status();

    let xbl_text = xbl_response
        .text()
        .await
        .map_err(|e| format!("Xbox Live response read failed: {}", e))?;

    if !xbl_status.is_success() {
        return Err(format!(
            "Xbox Live request failed with HTTP {}: {}",
            xbl_status, xbl_text
        ));
    }

    let xbl: XblResponse =
        serde_json::from_str(&xbl_text)
            .map_err(|e| {
                format!(
                    "Xbox Live response parse failed: {} — {}",
                    e, xbl_text
                )
            })?;

    let uhs = xbl
        .display_claims
        .xui
        .first()
        .ok_or_else(|| "No user hash in Xbox Live response.".to_string())?
        .uhs
        .clone();

    /*
     * XSTS authentication.
     */
    let xsts_body = serde_json::json!({
        "Properties": {
            "SandboxId": "RETAIL",
            "UserTokens": [xbl.token]
        },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });

    let xsts_response = client
        .post(XSTS_AUTH)
        .json(&xsts_body)
        .send()
        .await
        .map_err(|e| format!("XSTS request failed: {}", e))?;

    let xsts_status = xsts_response.status();

    let xsts_text = xsts_response
        .text()
        .await
        .map_err(|e| format!("XSTS response read failed: {}", e))?;

    if !xsts_status.is_success() {
        return Err(format!(
            "XSTS request failed with HTTP {}: {}",
            xsts_status, xsts_text
        ));
    }

    let xsts: XblResponse =
        serde_json::from_str(&xsts_text)
            .map_err(|e| {
                format!(
                    "XSTS response parse failed: {} — {}",
                    e, xsts_text
                )
            })?;

    /*
     * Minecraft authentication.
     */
    let minecraft_login_body = serde_json::json!({
        "identityToken": format!(
            "XBL3.0 x={};{}",
            uhs,
            xsts.token
        )
    });

    let mc_token_response = client
        .post(MC_LOGIN)
        .json(&minecraft_login_body)
        .send()
        .await
        .map_err(|e| format!("Minecraft login request failed: {}", e))?;

    let mc_status = mc_token_response.status();

    let mc_token_text = mc_token_response
        .text()
        .await
        .map_err(|e| {
            format!(
                "Minecraft token response read failed: {}",
                e
            )
        })?;

    if !mc_status.is_success() {
        return Err(format!(
            "Minecraft login failed with HTTP {}: {}",
            mc_status, mc_token_text
        ));
    }

    let mc_token: McTokenResponse =
        serde_json::from_str(&mc_token_text)
            .map_err(|e| {
                format!(
                    "Minecraft token response parse failed: {} — {}",
                    e, mc_token_text
                )
            })?;

    /*
     * Minecraft ownership.
     */
    let entitlements_response = client
        .get(MC_ENTITLEMENTS)
        .bearer_auth(&mc_token.access_token)
        .send()
        .await
        .map_err(|e| format!("Minecraft entitlement request failed: {}", e))?;

    let entitlements_status = entitlements_response.status();

    let entitlements_text = entitlements_response
        .text()
        .await
        .map_err(|e| {
            format!(
                "Minecraft entitlement response read failed: {}",
                e
            )
        })?;

    if !entitlements_status.is_success() {
        return Err(format!(
            "Minecraft entitlement check failed with HTTP {}: {}",
            entitlements_status, entitlements_text
        ));
    }

    let entitlements: McEntitlementsResponse =
        serde_json::from_str(&entitlements_text)
            .map_err(|e| {
                format!(
                    "Minecraft entitlement response parse failed: {} — {}",
                    e, entitlements_text
                )
            })?;

    if entitlements.items.is_empty() {
        return Err(
            "This Microsoft account does not own Minecraft.".to_string()
        );
    }

    /*
     * Minecraft profile.
     */
    let profile_response = client
        .get(MC_PROFILE)
        .bearer_auth(&mc_token.access_token)
        .send()
        .await
        .map_err(|e| format!("Minecraft profile request failed: {}", e))?;

    let profile_status = profile_response.status();

    let profile_text = profile_response
        .text()
        .await
        .map_err(|e| {
            format!(
                "Minecraft profile response read failed: {}",
                e
            )
        })?;

    if !profile_status.is_success() {
        return Err(format!(
            "Minecraft profile request failed with HTTP {}: {}",
            profile_status, profile_text
        ));
    }

    let mc_profile: McProfileResponse =
        serde_json::from_str(&profile_text)
            .map_err(|e| {
                format!(
                    "Minecraft profile parse failed: {} — {}",
                    e, profile_text
                )
            })?;

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