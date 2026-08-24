use std::fs;
use std::path::{ Path, PathBuf };
use std::process::Command;
use std::collections::HashSet;

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

fn push_candidate(root: PathBuf, candidates: &mut Vec<String>, seen: &mut HashSet<PathBuf>) {
    if !root.is_dir() {
        return;
    }
    let exe_name = if cfg!(windows) { "javaw.exe" } else { "java" };
    let exe = root.join("bin").join(exe_name);
    // Resolve symlinks so multiple aliases (common under /usr/lib/jvm on
    // Fedora/RHEL, which has many names pointing at the same underlying
    // install) collapse to a single entry instead of one per alias.
    let canonical = fs::canonicalize(&exe).unwrap_or(exe);
    if seen.insert(canonical) {
        candidates.push(root.to_string_lossy().to_string());
    }
}

#[tauri::command]
pub fn discover_java_candidates(data_dir: String) -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    // /usr/lib/jvm first — these are the most descriptive root names, so
    // they "win" the dedupe over generic PATH-derived roots like /usr.
    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = fs::read_dir("/usr/lib/jvm") {
            for entry in entries.flatten() {
                push_candidate(entry.path(), &mut candidates, &mut seen);
            }
        }
    }

    if let Ok(home) = std::env::var("JAVA_HOME") {
        if !home.is_empty() {
            push_candidate(PathBuf::from(home), &mut candidates, &mut seen);
        }
    }

    if let Ok(path_var) = std::env::var("PATH") {
        let exe_name = if cfg!(windows) { "java.exe" } else { "java" };
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(exe_name);
            if candidate.is_file() {
                if let Some(bin_dir) = candidate.parent() {
                    if let Some(root) = bin_dir.parent() {
                        push_candidate(root.to_path_buf(), &mut candidates, &mut seen);
                    }
                }
            }
        }
    }

    let runtime_dir = Path::new(&data_dir).join("runtime");
    if let Ok(entries) = fs::read_dir(&runtime_dir) {
        for entry in entries.flatten() {
            push_candidate(entry.path(), &mut candidates, &mut seen);
        }
    }

    #[cfg(target_os = "windows")]
    {
        for base in ["C:\\Program Files\\Java", "C:\\Program Files\\Eclipse Adoptium"] {
            if let Ok(entries) = fs::read_dir(base) {
                for entry in entries.flatten() {
                    push_candidate(entry.path(), &mut candidates, &mut seen);
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(entries) = fs::read_dir("/Library/Java/JavaVirtualMachines") {
            for entry in entries.flatten() {
                push_candidate(entry.path().join("Contents/Home"), &mut candidates, &mut seen);
            }
        }
    }

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
