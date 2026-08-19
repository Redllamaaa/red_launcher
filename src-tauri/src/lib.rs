// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use std::io::{Read, Write};
use std::net::TcpListener;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn await_microsoft_auth_code(port: u16) -> Result<String, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
        .map_err(|e| format!("Failed to bind listener: {}", e))?;

    let request = tauri::async_runtime::spawn_blocking(move || {
        let (mut stream, _) = listener.accept().expect("failed to accept connection");
        let mut buffer = [0u8; 4096];
        let bytes_read = stream.read(&mut buffer).unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();

        let has_code = request.contains("code=");
        let response_body = if has_code {
            "<html><body><h2>Login successful. You can close this window.</h2></body></html>"
        } else {
            "<html><body><h2>Login failed. You can close this window and try again.</h2></body></html>"
        };
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        let _ = stream.write_all(response.as_bytes());

        request
    })
    .await
    .map_err(|e| format!("Listener task failed: {}", e))?;

    let first_line = request.lines().next().unwrap_or("");
    let path_and_query = first_line.split_whitespace().nth(1).unwrap_or("");
    let query = path_and_query.split('?').nth(1).unwrap_or("");

    let mut code: Option<String> = None;
    let mut error: Option<String> = None;
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let value = parts.next().unwrap_or("");
        if key == "code" {
            code = Some(value.to_string());
        } else if key == "error" {
            error = Some(value.to_string());
        }
    }

    code.ok_or_else(|| error.unwrap_or_else(|| "No code returned".to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, await_microsoft_auth_code])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
