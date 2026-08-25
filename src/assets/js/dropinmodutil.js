/**
 * DropinModUtil
 *
 * Scans for, adds, removes, and toggles drop-in mods and shaderpacks on
 * the local filesystem. Ported from the Electron/fs-extra version — all
 * filesystem access now goes through @tauri-apps/plugin-fs instead of
 * Node's fs/fs-extra/electron, so every exported function is now async.
 *
 * TODO(Red): deleteDropinMod does a permanent delete via the fs plugin's
 * remove(). The old Electron build moved the file to the OS trash instead
 * (see SHELL_OPCODE.TRASH_ITEM in ipcconstants.js). Tauri's fs/shell
 * plugins don't expose a trash API — if you want that behavior back it
 * needs a Rust command, same pattern as javaguard.rs.
 */
import {
  exists,
  mkdir,
  readDir,
  remove,
  rename,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import { LoggerUtil } from "./scripts/loggerutil.js";

const logger = LoggerUtil.getLogger("DropinModUtil");

// Group #1: File Name (without .disabled, if any)
// Group #2: File Extension (jar, zip, or litemod)
// Group #3: If it is disabled (if string 'disabled' is present)
const MOD_REGEX = /^(.+(jar|zip|litemod))(?:\.(disabled))?$/;
const DISABLED_EXT = ".disabled";

const SHADER_REGEX = /^(.+)\.zip$/;
const SHADER_OPTION = /shaderPack=(.+)/;
const SHADER_DIR = "shaderpacks";
const SHADER_CONFIG = "optionsshaders.txt";

// Tauri's fs plugin wants forward slashes regardless of platform — same
// helper as configmanager.js/distromanager.js, kept local to avoid a
// circular import back into configmanager.js.
function pathJoin(...parts) {
  return parts.join("/").replace(/\/+/g, "/");
}

/**
 * Validate that the given directory exists. If not, it is created.
 *
 * @param {string} dir The path to the directory.
 */
export async function validateDir(dir) {
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Scan for drop-in mods in both the mods folder and version-safe
 * mods folder.
 *
 * @param {string} modsDir The path to the mods directory.
 * @param {string} version The minecraft version of the server configuration.
 *
 * @returns {Promise<{fullName: string, name: string, ext: string, disabled: boolean}[]>}
 * An array of objects storing metadata about each discovered mod.
 */
export async function scanForDropinMods(modsDir, version) {
  const modsDiscovered = [];

  if (await exists(modsDir)) {
    for (const entry of await readDir(modsDir)) {
      if (entry.isDirectory) continue;
      const match = MOD_REGEX.exec(entry.name);
      if (match != null) {
        modsDiscovered.push({
          fullName: match[0],
          name: match[1],
          ext: match[2],
          disabled: match[3] != null,
        });
      }
    }

    const versionDir = pathJoin(modsDir, version);
    if (await exists(versionDir)) {
      for (const entry of await readDir(versionDir)) {
        if (entry.isDirectory) continue;
        const match = MOD_REGEX.exec(entry.name);
        if (match != null) {
          modsDiscovered.push({
            fullName: pathJoin(version, match[0]),
            name: match[1],
            ext: match[2],
            disabled: match[3] != null,
          });
        }
      }
    }
  }

  return modsDiscovered;
}

/**
 * Add drop-in mods by moving them into the mods directory.
 *
 * @param {{name: string, path: string}[]} files The files to add
 * (as returned by the drag/drop or dialog plugin — needs `name` + `path`).
 * @param {string} modsDir The path to the mods directory.
 */
export async function addDropinMods(files, modsDir) {
  await validateDir(modsDir);

  for (const f of files) {
    if (MOD_REGEX.exec(f.name) != null) {
      await rename(f.path, pathJoin(modsDir, f.name));
    }
  }
}

/**
 * Delete a drop-in mod from the file system.
 *
 * @param {string} modsDir The path to the mods directory.
 * @param {string} fullName The fullName of the discovered mod to delete.
 *
 * @returns {Promise<boolean>} True if the mod was deleted, otherwise false.
 */
export async function deleteDropinMod(modsDir, fullName) {
  try {
    await remove(pathJoin(modsDir, fullName));
    return true;
  } catch (err) {
    logger.error("Error deleting drop-in mod.", err);
    return false;
  }
}

/**
 * Toggle a discovered mod on or off. This is achieved by adding or
 * removing the .disabled extension on the local file.
 *
 * @param {string} modsDir The path to the mods directory.
 * @param {string} fullName The fullName of the discovered mod to toggle.
 * @param {boolean} enable Whether to toggle on or off the mod.
 *
 * @returns {Promise<void>} Resolves when the mod has been toggled.
 */
export async function toggleDropinMod(modsDir, fullName, enable) {
  const oldPath = pathJoin(modsDir, fullName);
  const newPath = pathJoin(
    modsDir,
    enable
      ? fullName.substring(0, fullName.indexOf(DISABLED_EXT))
      : fullName + DISABLED_EXT,
  );
  await rename(oldPath, newPath);
}

/**
 * Check if a drop-in mod is enabled.
 *
 * @param {string} fullName The fullName of the discovered mod to toggle.
 * @returns {boolean} True if the mod is enabled, otherwise false.
 */
export function isDropinModEnabled(fullName) {
  return !fullName.endsWith(DISABLED_EXT);
}

/**
 * Scan for shaderpacks inside the shaderpacks folder.
 *
 * @param {string} instanceDir The path to the server instance directory.
 *
 * @returns {Promise<{fullName: string, name: string}[]>}
 * An array of objects storing metadata about each discovered shaderpack.
 */
export async function scanForShaderpacks(instanceDir) {
  const shaderDir = pathJoin(instanceDir, SHADER_DIR);
  const packsDiscovered = [{ fullName: "OFF", name: "Off (Default)" }];

  if (await exists(shaderDir)) {
    for (const entry of await readDir(shaderDir)) {
      if (entry.isDirectory) continue;
      const match = SHADER_REGEX.exec(entry.name);
      if (match != null) {
        packsDiscovered.push({ fullName: match[0], name: match[1] });
      }
    }
  }

  return packsDiscovered;
}

/**
 * Read the optionsshaders.txt file to locate the current enabled pack.
 * If the file does not exist, OFF is returned.
 *
 * @param {string} instanceDir The path to the server instance directory.
 *
 * @returns {Promise<string>} The file name of the enabled shaderpack.
 */
export async function getEnabledShaderpack(instanceDir) {
  await validateDir(instanceDir);

  const optionsShaders = pathJoin(instanceDir, SHADER_CONFIG);
  if (await exists(optionsShaders)) {
    const buf = await readTextFile(optionsShaders);
    const match = SHADER_OPTION.exec(buf);
    if (match != null) {
      return match[1];
    }
    logger.warn("Shaderpack regex failed.");
  }
  return "OFF";
}

/**
 * Set the enabled shaderpack.
 *
 * @param {string} instanceDir The path to the server instance directory.
 * @param {string} pack The file name of the shaderpack.
 */
export async function setEnabledShaderpack(instanceDir, pack) {
  await validateDir(instanceDir);

  const optionsShaders = pathJoin(instanceDir, SHADER_CONFIG);
  let buf;
  if (await exists(optionsShaders)) {
    buf = await readTextFile(optionsShaders);
    buf = buf.replace(SHADER_OPTION, `shaderPack=${pack}`);
  } else {
    buf = `shaderPack=${pack}`;
  }
  await writeTextFile(optionsShaders, buf);
}

/**
 * Add shaderpacks by moving them into the instance's shaderpacks folder.
 *
 * @param {{name: string, path: string}[]} files The files to add.
 * @param {string} instanceDir The path to the server instance directory.
 */
export async function addShaderpacks(files, instanceDir) {
  const p = pathJoin(instanceDir, SHADER_DIR);
  await validateDir(p);

  for (const f of files) {
    if (SHADER_REGEX.exec(f.name) != null) {
      await rename(f.path, pathJoin(p, f.name));
    }
  }
}
