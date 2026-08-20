mod token_store;
mod account_auth;
mod account_logout;

use token_store::{store_account_tokens, get_account_tokens, remove_account_tokens};
use account_auth::{start_microsoft_device_code, poll_microsoft_device_code, refresh_microsoft_account};
use account_logout::logout_microsoft;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            start_microsoft_device_code,
            poll_microsoft_device_code,
            refresh_microsoft_account,
            store_account_tokens,
            get_account_tokens,
            remove_account_tokens,
            logout_microsoft,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}