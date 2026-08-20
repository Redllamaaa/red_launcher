#[tauri::command]
pub async fn logout_microsoft(uuid: String) -> Result<(), String> {
    crate::token_store::remove_account_tokens(uuid).await
}