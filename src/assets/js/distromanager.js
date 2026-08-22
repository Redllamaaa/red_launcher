import { invoke } from "@tauri-apps/api/core";
import { LoggerUtil } from "./scripts/loggerutil.js";

const logger = LoggerUtil.getLogger("DistroManager");

export const REMOTE_DISTRO_URL =
  "https://raw.githubusercontent.com/Redllamaaa/tsmplauncher/master/app/assets/distribution.json";

// Module type constants, mirroring the `type` field on entries in
// distribution.json. Replaces the now-removed `helios-distribution-types`
// npm package — kept as a plain string enum since Rust's ModuleType
// (distromanager.rs) serializes to these same PascalCase strings via
// #[serde(rename_all = "PascalCase")].
export const Type = {
  Library: "Library",
  ForgeHosted: "ForgeHosted",
  Forge: "Forge",
  LiteLoader: "LiteLoader",
  ForgeMod: "ForgeMod",
  LiteMod: "LiteMod",
  FabricMod: "FabricMod",
  Fabric: "Fabric",
  VersionManifest: "VersionManifest",
  File: "File",
};

// ---------------------------------------------------------------------
// Maven identifier parsing
// Format: group:artifact:version[@extension]
// Non-maven ids (e.g. "servers.dat", "crafting_recipes.zs") are left
// unparsed — mavenComponents is null and the versionless identifier
// falls back to the raw id.
// ---------------------------------------------------------------------
function parseMavenComponents(id) {
  const parts = id.split(":");
  if (parts.length !== 3) {
    return null;
  }
  const [group, artifact, versionAndExt] = parts;
  const atIdx = versionAndExt.indexOf("@");
  const version =
    atIdx === -1 ? versionAndExt : versionAndExt.substring(0, atIdx);
  const extension = atIdx === -1 ? null : versionAndExt.substring(atIdx + 1);
  return { group, artifact, version, extension };
}

class Module {
  constructor(rawModule) {
    this.rawModule = rawModule;
    this.mavenComponents = parseMavenComponents(rawModule.id);
    this.subModules = (rawModule.subModules ?? []).map((m) => new Module(m));
  }

  getRequired() {
    if (this.rawModule.required == null) {
      return { value: true, def: true };
    }
    const { value, def } = this.rawModule.required;
    return { value, def: def ?? value };
  }

  hasSubModules() {
    return this.subModules.length > 0;
  }

  getVersionlessMavenIdentifier() {
    if (this.mavenComponents == null) {
      return this.rawModule.id;
    }
    return `${this.mavenComponents.group}:${this.mavenComponents.artifact}`;
  }
}

class Server {
  constructor(rawServer) {
    this.rawServer = rawServer;
    this.effectiveJavaOptions = rawServer.effectiveJavaOptions;
    this.modules = (rawServer.modules ?? []).map((m) => new Module(m));

    // rawServer.address is "host:port" per distribution.json — split it
    // out here so call sites can keep using serv.hostname / serv.port
    // the way they did against the old Electron/helios-core shape.
    const lastColon = rawServer.address.lastIndexOf(":");
    if (lastColon === -1) {
      this.hostname = rawServer.address;
      this.port = 25565;
    } else {
      this.hostname = rawServer.address.substring(0, lastColon);
      this.port = Number.parseInt(
        rawServer.address.substring(lastColon + 1),
        10,
      );
    }
  }
}

class Distribution {
  constructor(rawDistribution) {
    this.rawDistribution = rawDistribution;
    this.servers = (rawDistribution.servers ?? []).map((s) => new Server(s));
  }

  getServerById(id) {
    if (id == null) return null;
    return this.servers.find((s) => s.rawServer.id === id) ?? null;
  }
}

// ---------------------------------------------------------------------
// Public API — same shape as the old stub, now backed by real Tauri
// commands. A single in-flight promise is cached so concurrent callers
// (settings.js, landing.js, uibinder.js can all call getDistribution()
// around startup) don't each trigger their own network/disk hit.
// ---------------------------------------------------------------------

let cachedDistribution = null;
let inFlight = null;

export const DistroAPI = {
  /**
   * Returns the current distribution, loading it (memory -> disk cache
   * -> network, in that order) if it hasn't been loaded yet.
   */
  getDistribution: async () => {
    if (cachedDistribution != null) {
      return cachedDistribution;
    }
    if (inFlight != null) {
      return inFlight;
    }
    inFlight = (async () => {
      try {
        const raw = await invoke("get_distribution");
        cachedDistribution = new Distribution(raw);
        return cachedDistribution;
      } catch (err) {
        logger.error("Failed to load distribution index.", err);
        throw err;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  /**
   * Forces a network refresh, falling back to the on-disk cache on
   * failure. Updates the in-memory cache used by getDistribution().
   */
  refreshDistributionOrFallback: async () => {
    try {
      const raw = await invoke("refresh_distribution_or_fallback");
      cachedDistribution = new Distribution(raw);
      return cachedDistribution;
    } catch (err) {
      logger.error("Failed to refresh distribution index.", err);
      throw err;
    }
  },

  toggleDevMode: async (value) => {
    await invoke("toggle_dev_mode", { value });
  },

  isDevMode: async () => {
    return await invoke("is_dev_mode");
  },
};
