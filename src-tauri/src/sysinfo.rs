use serde::Serialize;
use sysinfo::System;

#[derive(Serialize)]
pub struct MemoryInfo {
    total_mem: u64, // bytes
    free_mem: u64, // bytes
}

#[tauri::command]
pub fn get_memory_info() -> MemoryInfo {
    let mut sys = System::new_all();
    sys.refresh_memory();

    MemoryInfo {
        total_mem: sys.total_memory(), // sysinfo returns bytes as of 0.30+
        free_mem: sys.available_memory(), // prefer available_memory over free_memory
    }
}
