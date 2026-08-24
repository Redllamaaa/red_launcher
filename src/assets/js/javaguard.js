import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { platform, arch } from "@tauri-apps/plugin-os";
import { mkdir, exists } from "@tauri-apps/plugin-fs";
import semver from "semver";
import { LoggerUtil } from "./scripts/loggerutil.js";

const log = LoggerUtil.getLogger("JavaGuard");

/**
 * Normalize a user- or system-selected path so it points to the ROOT of a
 * JDK install (the dir containing bin/java), not the executable itself or
 * a macOS .app bundle.
 */
export function ensureJavaDirIsRoot(selectedPath) {
  if (!selectedPath) return selectedPath;
  let p = selectedPath.replace(/\\/g, "/").replace(/\/+$/, "");

  const base = p.substring(p.lastIndexOf("/") + 1).toLowerCase();
  if (base === "java" || base === "java.exe" || base === "javaw.exe") {
    p = p.substring(0, p.lastIndexOf("/"));
    if (p.toLowerCase().endsWith("/bin")) {
      p = p.substring(0, p.length - 4);
    }
  }

  if (p.toLowerCase().endsWith(".app")) {
    p = `${p}/Contents/Home`;
  }

  return p;
}

/**
 * Resolve the platform-specific java executable from a JDK root dir.
 */
export function javaExecFromRoot(root) {
  if (!root) return root;
  const clean = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return platform() === "windows"
    ? `${clean}/bin/javaw.exe`
    : `${clean}/bin/java`;
}

function parseJavaVersionOutput(raw) {
  const versionMatch = raw.match(/version "([\d._]+)(?:-[\w.]+)?"/);
  if (versionMatch == null) return null;

  let ver = versionMatch[1];
  if (ver.startsWith("1.")) {
    // Legacy "1.8.0_XXX" -> "8.0.XXX"
    const parts = ver.split(".");
    ver = `${parts[1]}.0.${(parts[2] || "0").replace("_", ".")}`;
  }
  const coerced = semver.coerce(ver);
  if (coerced == null) return null;

  let vendor = "Unknown";
  if (/temurin/i.test(raw)) vendor = "Eclipse Temurin";
  else if (/corretto/i.test(raw)) vendor = "Amazon Corretto";
  else if (/zulu/i.test(raw)) vendor = "Azul Zulu";
  else if (/oracle/i.test(raw)) vendor = "Oracle";
  else if (/openjdk/i.test(raw)) vendor = "OpenJDK";

  return { semverStr: coerced.version, vendor };
}

/**
 * Validate a JDK root dir has a working java satisfying `supported` (semver range).
 *
 * @param {string} rootDir JDK root directory (NOT the executable path).
 * @param {string} supported Semver range, e.g. ">=17.0.0 <18.0.0".
 * @returns {Promise<{semverStr: string, vendor: string} | null>}
 */
export async function validateSelectedJvm(rootDir, supported) {
  if (!rootDir) return null;
  const execPath = javaExecFromRoot(rootDir);

  if (!(await exists(execPath))) {
    return null;
  }

  let raw;
  try {
    raw = await invoke("run_java_version", { execPath });
  } catch (err) {
    log.warn(`run_java_version failed for ${execPath}:`, err);
    return null;
  }

  const parsed = raw ? parseJavaVersionOutput(raw) : null;
  if (parsed == null) {
    log.warn(`Could not parse java -version output for ${execPath}:`, raw);
    return null;
  }
  if (
    supported &&
    !semver.satisfies(parsed.semverStr, supported, { includePrerelease: true })
  ) {
    log.warn(
      `${execPath} is ${parsed.semverStr}, doesn't satisfy ${supported}`,
    );
    return null;
  }
  return parsed;
}

/**
 * Ask Rust for JVM candidates, validate each, and return every one that
 * satisfies `supported` — sorted newest first. Used to power a manual
 * "Detect" picker (as opposed to discoverBestJvmInstallation, which is
 * for silent auto-selection of a single best match).
 */
export async function discoverAllJvmInstallations(dataDir, supported) {
  let candidates = [];
  try {
    candidates = await invoke("discover_java_candidates", { dataDir });
  } catch {
    candidates = [];
  }

  const results = [];
  for (const root of candidates) {
    const details = await validateSelectedJvm(root, supported);
    if (details == null) continue;
    results.push({ path: root, ...details });
  }

  results.sort((a, b) => (semver.gt(a.semverStr, b.semverStr) ? -1 : 1));
  return results;
}

/**
 * Ask Rust for JVM candidates (JAVA_HOME, PATH, common install dirs, and
 * anything previously downloaded into dataDir/runtime), validate each, and
 * return the newest one satisfying `supported`.
 */
export async function discoverBestJvmInstallation(dataDir, supported) {
  let candidates = [];
  try {
    candidates = await invoke("discover_java_candidates", { dataDir });
    log.info(`Discovered ${candidates.length} JVM candidate(s):`, candidates);
  } catch (err) {
    log.error("discover_java_candidates failed:", err);
    candidates = [];
  }

  let best = null;
  for (const root of candidates) {
    const details = await validateSelectedJvm(root, supported);
    if (details == null) {
      log.warn(`Candidate rejected (invalid or unsupported): ${root}`);
      continue;
    }
    log.info(
      `Candidate valid: ${root} -> ${details.semverStr} (${details.vendor})`,
    );
    if (best == null || semver.gt(details.semverStr, best.semverStr)) {
      best = { path: root, ...details };
    }
  }
  return best;
}

/**
 * Query Adoptium (Eclipse Temurin) for the latest OpenJDK matching `major`
 * and the current OS/arch.
 */
export async function latestOpenJDK(major, dataDir, distribution = "temurin") {
  const osMap = { windows: "windows", macos: "mac", linux: "linux" };
  const archMap = { x86_64: "x64", aarch64: "aarch64" };
  const os = osMap[platform()] ?? "linux";
  const archName = archMap[arch()] ?? "x64";

  const apiUrl = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?image_type=jdk&os=${os}&architecture=${archName}`;

  let data;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;

  const pkg = data[0].binary?.package;
  if (pkg == null) return null;

  const runtimeDir = `${dataDir.replace(/\/+$/, "")}/runtime`;
  if (!(await exists(runtimeDir))) {
    await mkdir(runtimeDir, { recursive: true });
  }

  return {
    id: `${distribution}-${data[0].version.semver}`,
    url: pkg.link,
    size: pkg.size,
    algo: "sha256",
    hash: pkg.checksum,
    path: `${runtimeDir}/${pkg.name}`,
  };
}

/**
 * Extract a downloaded JDK archive, return the path to its java executable.
 */
export async function extractJdk(archivePath) {
  const destDir = archivePath.replace(/\.(zip|tar\.gz|tgz)$/i, "");
  return invoke("extract_jdk_archive", { archivePath, destDir });
}
