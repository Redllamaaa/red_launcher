use std::fs;
use std::path::{ Path, PathBuf };
use std::process::Command;

#[tauri::command]
pub fn run_java_version(exec_path: String) -> Result<String, String> {
    let output = Command::new(&exec_path)
        .arg("-version")
        .output()
        .map_err(|e| e.to_string())?;

    // Every vendor we care about writes `-version` output to stderr.
    let text = if !output.stderr.is_empty() {
        String::from_utf8_lossy(&output.stderr).to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    if text.trim().is_empty() {
        return Err("No output from java -version".into());
    }
    Ok(text)
}

#[tauri::command]
pub fn discover_java_candidates(data_dir: String) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    if let Ok(home) = std::env::var("JAVA_HOME") {
        if !home.is_empty() {
            candidates.push(home);
        }
    }

    if let Ok(path_var) = std::env::var("PATH") {
        let exe_name = if cfg!(windows) { "java.exe" } else { "java" };
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(exe_name);
            if candidate.is_file() {
                if let Some(bin_dir) = candidate.parent() {
                    if let Some(root) = bin_dir.parent() {
                        // Guard against malformed PATH entries resolving to a
                        // non-directory root (e.g. a project source file that
                        // happens to have a sibling/child literally named "java").
                        if root.is_dir() {
                            candidates.push(root.to_string_lossy().to_string());
                        } else {
                            eprintln!(
                                "Skipping bogus java candidate root (not a directory): {}",
                                root.display()
                            );
                        }
                    }
                }
            }
        }
    }

    let runtime_dir = Path::new(&data_dir).join("runtime");
    if let Ok(entries) = fs::read_dir(&runtime_dir) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                candidates.push(entry.path().to_string_lossy().to_string());
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for base in ["C:\\Program Files\\Java", "C:\\Program Files\\Eclipse Adoptium"] {
            if let Ok(entries) = fs::read_dir(base) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        candidates.push(entry.path().to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(entries) = fs::read_dir("/Library/Java/JavaVirtualMachines") {
            for entry in entries.flatten() {
                let home = entry.path().join("Contents/Home");
                if home.is_dir() {
                    candidates.push(home.to_string_lossy().to_string());
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = fs::read_dir("/usr/lib/jvm") {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    candidates.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }

    candidates.sort();
    candidates.dedup();
    candidates
}

#[tauri::command]
pub fn extract_jdk_archive(archive_path: String, dest_dir: String) -> Result<String, String> {
    let archive = PathBuf::from(&archive_path);
    let dest = PathBuf::from(&dest_dir);
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    if archive_path.to_lowercase().ends_with(".zip") {
        let file = fs::File::open(&archive).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        zip.extract(&dest).map_err(|e| e.to_string())?;
    } else {
        let file = fs::File::open(&archive).map_err(|e| e.to_string())?;
        let gz = flate2::read::GzDecoder::new(file);
        let mut tar = tar::Archive::new(gz);
        tar.unpack(&dest).map_err(|e| e.to_string())?;
    }

    // Archives extract into one nested top-level folder (e.g. jdk-17.0.9+9).
    let top_level = fs
        ::read_dir(&dest)
        .map_err(|e| e.to_string())?
        .flatten()
        .find(|e| e.path().is_dir())
        .map(|e| e.path())
        .unwrap_or_else(|| dest.clone());

    let exec_name = if cfg!(windows) { "javaw.exe" } else { "java" };
    let exec_path = top_level.join("bin").join(exec_name);
    Ok(exec_path.to_string_lossy().to_string())
}
