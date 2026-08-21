import { invoke } from "@tauri-apps/api/core";

let cached = null;

export async function getMemoryInfo() {
  cached = await invoke("get_memory_info"); // { total_mem, free_mem } in bytes
  return cached;
}

// Sync accessor for code that runs after getMemoryInfo() has resolved once.
export function getCachedMemoryInfo() {
  if (cached == null) {
    throw new Error("Memory info not yet loaded — call getMemoryInfo() first.");
  }
  return cached;
}
