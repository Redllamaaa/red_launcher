mod account_auth;
mod account_logout;
mod token_store;
mod sysinfo;
mod javaguard;
mod mcstatus;
mod auth_error;
mod distromanager;

use account_auth::{
    cancel_microsoft_device_code,
    poll_microsoft_device_code,
    refresh_microsoft_account,
    start_microsoft_device_code,
    CancelledDeviceCodes,
};
use account_logout::logout_microsoft;
use token_store::{ get_account_tokens, remove_account_tokens, store_account_tokens };
use sysinfo::get_memory_info;
use javaguard::{ discover_java_candidates, run_java_version, extract_jdk_archive };
use mcstatus::get_server_status;
use distromanager::{
    get_distribution,
    refresh_distribution_or_fallback,
    toggle_dev_mode,
    is_dev_mode,
    DistroState,
};

use tauri_plugin_log::{ Target, TargetKind };

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder
        ::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(CancelledDeviceCodes::default())
        .manage(DistroState::default())
        .plugin(
            tauri_plugin_log::Builder
                ::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .build()
        )
        .invoke_handler(
            tauri::generate_handler![
                start_microsoft_device_code,
                poll_microsoft_device_code,
                cancel_microsoft_device_code,
                refresh_microsoft_account,
                store_account_tokens,
                get_account_tokens,
                remove_account_tokens,
                logout_microsoft,
                get_memory_info,
                discover_java_candidates,
                run_java_version,
                extract_jdk_archive,
                get_server_status,
                get_distribution,
                refresh_distribution_or_fallback,
                toggle_dev_mode,
                is_dev_mode
            ]
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
