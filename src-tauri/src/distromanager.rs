use serde::{ Deserialize, Serialize };
use std::path::PathBuf;
use std::sync::atomic::{ AtomicBool, Ordering };
use std::sync::Mutex;
use tauri::{ AppHandle, Manager, State };

// ---------------------------------------------------------------------
// Raw schema — mirrors distribution.json exactly. Keep field names/casing
// in sync with the JSON; unknown/future fields are Option<> so old caches
// don't fail to deserialize after a schema addition.
// ---------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RawDistribution {
    pub version: String,
    pub servers: Vec<RawServer>,
    /// Not present in current distribution.json but kept for forward compat
    /// (landing.js checks `distro.rawDistribution.discord`).
    pub discord: Option<DiscordSettings>,
    pub rss: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiscordSettings {
    #[serde(rename = "clientId")]
    pub client_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RawServer {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub version: String,
    /// "host:port", as stored in distribution.json. Parsed into
    /// hostname/port on the JS wrapper (Server class), not here — keeps
    /// this struct a clean 1:1 mirror of the JSON file.
    pub address: String,
    #[serde(rename = "minecraftVersion")]
    pub minecraft_version: String,
    #[serde(rename = "mainServer", default)]
    pub main_server: bool,
    #[serde(default)]
    pub autoconnect: bool,
    #[serde(rename = "untrackedFiles", default)]
    pub untracked_files: Vec<UntrackedFilesEntry>,
    pub modules: Vec<RawModule>,
    /// Absent in the current file for every server in the sample —
    /// when missing we synthesize sane values in `effective_java_options`.
    #[serde(rename = "javaOptions")]
    pub java_options: Option<JavaOptions>,
    pub discord: Option<ServerDiscordSettings>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ServerDiscordSettings {
    #[serde(rename = "shortId")]
    pub short_id: Option<String>,
    #[serde(rename = "largeImageText")]
    pub large_image_text: Option<String>,
    #[serde(rename = "largeImageKey")]
    pub large_image_key: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UntrackedFilesEntry {
    #[serde(rename = "appliesTo", default)]
    pub applies_to: Vec<String>,
    #[serde(default)]
    pub patterns: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct JavaOptions {
    /// Semver range, e.g. ">=17". Optional in the source JSON.
    pub supported: Option<String>,
    pub distribution: Option<String>,
    #[serde(rename = "suggestedMajor")]
    pub suggested_major: Option<u32>,
    pub ram: Option<RamOptions>,
    #[serde(rename = "totalMem")]
    pub total_mem: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RamOptions {
    /// MB
    pub minimum: Option<u64>,
    /// MB
    pub recommended: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub enum ModuleType {
    Library,
    ForgeHosted,
    Forge,
    LiteLoader,
    ForgeMod,
    LiteMod,
    FabricMod,
    Fabric,
    VersionManifest,
    File,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RawModule {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub module_type: ModuleType,
    pub artifact: Artifact,
    #[serde(rename = "subModules", default)]
    pub sub_modules: Vec<RawModule>,
    pub required: Option<RequiredFlag>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RequiredFlag {
    pub value: bool,
    /// Not present in sample data; JS getRequired() falls back to
    /// `value` when `def` is absent.
    pub def: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Artifact {
    pub size: u64,
    #[serde(rename = "MD5")]
    pub md5: Option<String>,
    pub url: String,
    /// Present on File-type modules (relative install path).
    pub path: Option<String>,
}

// ---------------------------------------------------------------------
// Derived / computed data sent alongside the raw payload. Frontend reads
// `server.effective_java_options` the same way it previously read the
// (never-actually-present) `server.effectiveJavaOptions` from the stub.
// ---------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EffectiveJavaOptions {
    pub supported: String,
    pub distribution: String,
    #[serde(rename = "suggestedMajor")]
    pub suggested_major: u32,
    pub ram: RamOptions,
}

#[derive(Serialize, Clone, Debug)]
pub struct ServerWithEffectiveOptions {
    #[serde(flatten)]
    pub raw: RawServer,
    #[serde(rename = "effectiveJavaOptions")]
    pub effective_java_options: EffectiveJavaOptions,
}

#[derive(Serialize, Clone, Debug)]
pub struct DistributionResponse {
    pub version: String,
    pub servers: Vec<ServerWithEffectiveOptions>,
    pub discord: Option<DiscordSettings>,
    pub rss: Option<String>,
}

/// Minecraft version -> required Java major, since the distribution.json
/// in use doesn't ship per-server javaOptions. TODO(Red): confirm these
/// thresholds match what you actually want to require; if a server needs
/// to override, add `javaOptions` back into distribution.json for that
/// server and this function will prefer that instead.
fn suggested_major_for_mc_version(mc_version: &str) -> u32 {
    let parts: Vec<u32> = mc_version
        .split('.')
        .filter_map(|p| p.parse::<u32>().ok())
        .collect();
    let minor = parts.get(1).copied().unwrap_or(0);
    let patch = parts.get(2).copied().unwrap_or(0);

    if minor > 20 || (minor == 20 && patch >= 5) {
        21
    } else if minor >= 17 {
        17
    } else {
        8
    }
}

fn build_effective_java_options(server: &RawServer) -> EffectiveJavaOptions {
    if let Some(opts) = &server.java_options {
        let suggested_major = opts.suggested_major.unwrap_or_else(||
            suggested_major_for_mc_version(&server.minecraft_version)
        );
        return EffectiveJavaOptions {
            supported: opts.supported.clone().unwrap_or_else(|| format!(">={}", suggested_major)),
            distribution: opts.distribution.clone().unwrap_or_else(|| "TEMURIN".into()),
            suggested_major,
            ram: opts.ram.clone().unwrap_or_default(),
        };
    }

    let suggested_major = suggested_major_for_mc_version(&server.minecraft_version);
    EffectiveJavaOptions {
        supported: format!(">={}", suggested_major),
        distribution: "TEMURIN".into(),
        suggested_major,
        ram: RamOptions::default(),
    }
}

fn to_response(dist: RawDistribution) -> DistributionResponse {
    DistributionResponse {
        version: dist.version,
        discord: dist.discord,
        rss: dist.rss,
        servers: dist.servers
            .into_iter()
            .map(|s| {
                let effective_java_options = build_effective_java_options(&s);
                ServerWithEffectiveOptions {
                    raw: s,
                    effective_java_options,
                }
            })
            .collect(),
    }
}

// ---------------------------------------------------------------------
// State + commands
// ---------------------------------------------------------------------

const REMOTE_DISTRO_URL: &str =
    "https://raw.githubusercontent.com/Redllamaaa/tsmplauncher/master/app/assets/distribution.json";

#[derive(Default)]
pub struct DistroState {
    pub current: Mutex<Option<RawDistribution>>,
    pub dev_mode: AtomicBool,
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    Ok(dir.join("distribution.json"))
}

async fn fetch_remote() -> Result<RawDistribution, String> {
    let resp = reqwest
        ::get(REMOTE_DISTRO_URL).await
        .map_err(|e| format!("Failed to fetch distribution index: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Distribution index request failed with status {}", resp.status()));
    }

    resp.json::<RawDistribution>().await.map_err(|e|
        format!("Failed to parse distribution index: {e}")
    )
}

fn read_cache(app: &AppHandle) -> Result<RawDistribution, String> {
    let path = cache_path(app)?;
    let text = std::fs
        ::read_to_string(&path)
        .map_err(|e| format!("No cached distribution index available: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Cached distribution index is corrupt: {e}"))
}

fn write_cache(app: &AppHandle, dist: &RawDistribution) -> Result<(), String> {
    let path = cache_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    }
    let text = serde_json
        ::to_string_pretty(dist)
        .map_err(|e| format!("Failed to serialize distribution index: {e}"))?;
    std::fs::write(&path, text).map_err(|e| format!("Failed to write distribution cache: {e}"))
}

/// Fetch fresh from the network, cache to disk, update in-memory state.
/// Falls back to the on-disk cache if the network request fails.
#[tauri::command]
pub async fn refresh_distribution_or_fallback(
    app: AppHandle,
    state: State<'_, DistroState>
) -> Result<DistributionResponse, String> {
    let dist = match fetch_remote().await {
        Ok(d) => {
            let _ = write_cache(&app, &d);
            d
        }
        Err(err) => {
            log::warn!("Distribution refresh failed, falling back to cache: {err}");
            read_cache(&app)?
        }
    };

    *state.current.lock().unwrap() = Some(dist.clone());
    Ok(to_response(dist))
}

/// Return whatever is already in memory, otherwise load from disk cache,
/// otherwise attempt a network fetch as a last resort. Cheap to call
/// repeatedly (e.g. every `getServerById` lookup from JS).
#[tauri::command]
pub async fn get_distribution(
    app: AppHandle,
    state: State<'_, DistroState>
) -> Result<DistributionResponse, String> {
    if let Some(dist) = state.current.lock().unwrap().clone() {
        return Ok(to_response(dist));
    }

    if let Ok(dist) = read_cache(&app) {
        *state.current.lock().unwrap() = Some(dist.clone());
        return Ok(to_response(dist));
    }

    let dist = fetch_remote().await?;
    let _ = write_cache(&app, &dist);
    *state.current.lock().unwrap() = Some(dist.clone());
    Ok(to_response(dist))
}

#[tauri::command]
pub fn toggle_dev_mode(state: State<'_, DistroState>, value: bool) {
    state.dev_mode.store(value, Ordering::SeqCst);
}

#[tauri::command]
pub fn is_dev_mode(state: State<'_, DistroState>) -> bool {
    state.dev_mode.load(Ordering::SeqCst)
}
