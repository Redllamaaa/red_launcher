use serde::{Deserialize, Serialize};
use reqwest::Client;

const MS_DEVICE_CODE: &str =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const MS_OAUTH_TOKEN: &str =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

#[derive(Deserialize)]
struct DeviceCodeResponse {
  device_code: String,
  user_code: String,
  verification_uri: String,
  message: String,
  expires_in: u64,
  interval: u64,
}

#[derive(Serialize)]
pub struct DeviceCodeInfo {
  device_code: String,
  user_code: String,
  verification_uri: String,
  message: String,
  expires_in: u64,
  interval: u64,
}

#[derive(Serialize)]
pub struct MicrosoftAuthResult {
  ms_access_token: String,
  ms_refresh_token: String,
  ms_expires_in: u64,
  mc_access_token: String,
  mc_expires_in: u64,
  mc_uuid: String,
  mc_username: String,
}

#[derive(Deserialize)]
struct MsTokenResponse {
  access_token: String,
  refresh_token: String,
  expires_in: u64,
}

#[derive(Deserialize)]
struct XblResponse {
  #[serde(rename = "Token")]
  token: String,
  #[serde(rename = "DisplayClaims")]
  display_claims: XblDisplayClaims,
}

#[derive(Deserialize)]
struct XblDisplayClaims {
  xui: Vec<XblUserInfo>,
}

#[derive(Deserialize)]
struct XblUserInfo {
  uhs: String,
}

#[derive(Deserialize)]
struct McTokenResponse {
  access_token: String,
  expires_in: u64,
}

#[derive(Deserialize)]
struct McProfileResponse {
  id: String,
  name: String,
}

#[derive(Deserialize)]
struct McEntitlementsResponse {
  items: Vec<serde_json::Value>,
}


#[tauri::command]
pub async fn start_microsoft_device_code(client_id: String) -> Result<DeviceCodeInfo, String> {
  let client = Client::new();

  let resp = client
    .post(MS_DEVICE_CODE)
    .form(&[
      ("client_id", client_id.as_str()),
      ("scope", "XboxLive.signin offline_access"),
    ])
    .send()
    .await
    .map_err(|e| format!("Device code request failed: {}", e))?;

  let status = resp.status();
  let text = resp.text().await.map_err(|e| format!("Device code read failed: {}", e))?;

  if !status.is_success() {
    return Err(format!(
      "Device code request failed with HTTP {}: {}",
      status, text
    ));
  }

  let dc: DeviceCodeResponse =
    serde_json::from_str(&text).map_err(|e| format!("Device code parse failed: {} — {}", e, text))?;

  Ok(DeviceCodeInfo {
    device_code: dc.device_code,
    user_code: dc.user_code,
    verification_uri: dc.verification_uri,
    message: dc.message,
    expires_in: dc.expires_in,
    interval: dc.interval,
  })
}

#[tauri::command]
pub async fn poll_microsoft_device_code(
  client_id: String,
  device_code: String,
  interval: u64,
) -> Result<MicrosoftAuthResult, String> {
  let client = Client::new();

  // Respect the server-provided polling interval (falls back to a sane
  // minimum if the server ever reports something too aggressive).
  let mut wait_secs = interval.max(5);

  loop {
    let resp = client
      .post(MS_OAUTH_TOKEN)
      .form(&[
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ("client_id", client_id.as_str()),
        ("device_code", device_code.as_str()),
      ])
      .send()
      .await
      .map_err(|e| format!("Token poll request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Token poll read failed: {}", e))?;

    if status.is_success() {
      // Got tokens
      let ms_token: MsTokenResponse =
        serde_json::from_str(&text).map_err(|e| format!("MS token parse failed: {} — {}", e, text))?;
      // Continue with XBL → XSTS → MC
      return complete_minecraft_chain(client.clone(), ms_token).await;
    } else {
      // Check error type
      #[derive(Deserialize)]
      struct ErrorResp {
        error: String,
        error_description: Option<String>,
      }

      let err: ErrorResp =
        serde_json::from_str(&text).map_err(|e| format!("Error parse failed: {} — {}", e, text))?;

      match err.error.as_str() {
        "authorization_pending" => {
          // User hasn’t finished yet — wait and retry at the server's cadence.
          tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
          continue;
        }
        "slow_down" => {
          // Server wants us to back off further; grow the interval instead
          // of retrying at the same (too-fast) cadence.
          wait_secs += 5;
          tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
          continue;
        }
        "authorization_declined" => {
          return Err("Sign-in was cancelled or declined.".to_string());
        }
        "expired_token" => {
          return Err(
            "The sign-in code expired before completion. Please try again.".to_string(),
          );
        }
        "bad_verification_code" => {
          return Err("Invalid device code. Please try again.".to_string());
        }
        _ => {
          return Err(format!(
            "Device code flow failed: {} — {:?}",
            err.error, err.error_description
          ));
        }
      }
    }
  }
}

async fn complete_minecraft_chain(
  client: Client,
  ms_token: MsTokenResponse,
) -> Result<MicrosoftAuthResult, String> {
  // 2) Xbox Live
  let xbl_body = serde_json::json!({
    "Properties": {
      "AuthMethod": "RPS",
      "SiteName": "user.auth.xboxlive.com",
      "RpsTicket": format!("d={}", ms_token.access_token)
    },
    "RelyingParty": "http://auth.xboxlive.com",
    "TokenType": "JWT"
  });

  let xbl_response = client
    .post("https://user.auth.xboxlive.com/user/authenticate")
    .json(&xbl_body)
    .send()
    .await
    .map_err(|e| format!("XBL request failed: {}", e))?;

  let xbl_status = xbl_response.status();
  let xbl_text = xbl_response
    .text()
    .await
    .map_err(|e| format!("XBL response read failed: {}", e))?;

  if !xbl_status.is_success() {
    return Err(format!(
      "XBL request failed with HTTP {}: {}",
      xbl_status, xbl_text
    ));
  }

  let xbl: XblResponse = serde_json::from_str(&xbl_text)
    .map_err(|e| format!("XBL parse failed: {} — {}", e, xbl_text))?;

  let uhs = xbl
    .display_claims
    .xui
    .first()
    .ok_or("No user hash in XBL response")?
    .uhs
    .clone();

  // 3) XSTS
  let xsts_body = serde_json::json!({
    "Properties": {
      "SandboxId": "RETAIL",
      "UserTokens": [xbl.token]
    },
    "RelyingParty": "rp://api.minecraftservices.com/",
    "TokenType": "JWT"
  });

  let xsts_response = client
    .post("https://xsts.auth.xboxlive.com/xsts/authorize")
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

  let xsts: XblResponse = serde_json::from_str(&xsts_text)
    .map_err(|e| format!("XSTS parse failed: {} — {}", e, xsts_text))?;

  // 4) Minecraft access token
  let mc_login_body = serde_json::json!({
    "identityToken": format!("XBL3.0 x={};{}", uhs, xsts.token)
  });

  let mc_token_response = client
    .post("https://api.minecraftservices.com/authentication/login_with_xbox")
    .json(&mc_login_body)
    .send()
    .await
    .map_err(|e| format!("MC token request failed: {}", e))?;

  let mc_status = mc_token_response.status();
  let mc_token_text = mc_token_response
    .text()
    .await
    .map_err(|e| format!("MC token response read failed: {}", e))?;

  if !mc_status.is_success() {
    return Err(format!(
      "MC token request failed with HTTP {}: {}",
      mc_status, mc_token_text
    ));
  }

  let mc_token: McTokenResponse = serde_json::from_str(&mc_token_text)
    .map_err(|e| format!("MC token parse failed: {} — {}", e, mc_token_text))?;

  // 5) Check game ownership before we bother fetching a profile.
  let entitlements_response = client
    .get("https://api.minecraftservices.com/entitlements/mcstore")
    .bearer_auth(&mc_token.access_token)
    .send()
    .await
    .map_err(|e| format!("Entitlement check failed: {}", e))?;

  let entitlements_status = entitlements_response.status();
  let entitlements_text = entitlements_response
    .text()
    .await
    .map_err(|e| format!("Entitlement response read failed: {}", e))?;

  if !entitlements_status.is_success() {
    return Err(format!(
      "Entitlement check failed with HTTP {}: {}",
      entitlements_status, entitlements_text
    ));
  }

  let entitlements: McEntitlementsResponse = serde_json::from_str(&entitlements_text)
    .map_err(|e| format!("Entitlement parse failed: {} — {}", e, entitlements_text))?;

  if entitlements.items.is_empty() {
    return Err("This Microsoft account does not own Minecraft.".to_string());
  }

  // 6) Minecraft profile
  let mc_profile: McProfileResponse = client
    .get("https://api.minecraftservices.com/minecraft/profile")
    .bearer_auth(&mc_token.access_token)
    .send()
    .await
    .map_err(|e| format!("MC profile request failed: {}", e))?
    .json()
    .await
    .map_err(|e| format!("MC profile parse failed: {}", e))?;

  Ok(MicrosoftAuthResult {
    ms_access_token: ms_token.access_token,
    ms_refresh_token: ms_token.refresh_token,
    ms_expires_in: ms_token.expires_in,
    mc_access_token: mc_token.access_token,
    mc_expires_in: mc_token.expires_in,
    mc_uuid: mc_profile.id,
    mc_username: mc_profile.name,
  })
}