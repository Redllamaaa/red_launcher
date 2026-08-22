use crate::auth_error::AuthError;

#[tauri::command]
pub async fn logout_microsoft(uuid: String) -> Result<(), AuthError> {
    crate::token_store::remove_account_tokens(uuid).await
}
