use keyring::Entry;
use serde::{Deserialize, Serialize};

/// Keyring service name — shows up as the "app" a credential belongs to
/// in Windows Credential Manager / macOS Keychain / Linux Secret Service.
const SERVICE_NAME: &str = "red-launcher-msft-auth";

/// The sensitive half of an account's auth state. Everything else
/// (username, uuid, expiresAt for display, selectedAccount) stays in
/// the existing JS-side ConfigManager — this only holds what actually
/// grants access to the account.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AccountTokens {
    pub ms_access_token: String,
    pub ms_refresh_token: String,
    pub ms_expires_at: String, // ISO date string, mirrors ConfigManager's calculateExpiryDate output

    pub mc_access_token: String,
    pub mc_expires_at: String,
}

fn entry_for(uuid: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, uuid)
        .map_err(|e| format!("Failed to access secure storage for {uuid}: {e}"))
}

/// Store (or overwrite) the token set for an account.
#[tauri::command]
pub async fn store_account_tokens(
    uuid: String,
    tokens: AccountTokens,
) -> Result<(), String> {
    let entry = entry_for(&uuid)?;

    let serialized = serde_json::to_string(&tokens)
        .map_err(|e| format!("Failed to serialize tokens for {uuid}: {e}"))?;

    entry
        .set_password(&serialized)
        .map_err(|e| format!("Failed to store tokens for {uuid}: {e}"))?;

    Ok(())
}

/// Retrieve the token set for an account, if present.
#[tauri::command]
pub async fn get_account_tokens(
    uuid: String,
) -> Result<Option<AccountTokens>, String> {
    let entry = entry_for(&uuid)?;

    match entry.get_password() {
        Ok(serialized) => {
            let tokens: AccountTokens = serde_json::from_str(&serialized)
                .map_err(|e| format!("Failed to parse stored tokens for {uuid}: {e}"))?;
            Ok(Some(tokens))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read tokens for {uuid}: {e}")),
    }
}

/// Remove the token set for an account. Returns Ok(()) even if no
/// entry existed — removal is idempotent from the caller's perspective.
#[tauri::command]
pub async fn remove_account_tokens(uuid: String) -> Result<(), String> {
    let entry = entry_for(&uuid)?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to remove tokens for {uuid}: {e}")),
    }
}