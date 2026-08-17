import { ipcRenderer } from "electron";
import fs from "fs-extra";
import os from "os";
import path from "path";

import ConfigManager from "./configmanager";
import { DistroAPI } from "./distromanager";
import LangLoader from "./langloader";
import { LoggerUtil } from "helios-core";
import { HeliosDistribution } from "helios-core/common";

const logger = LoggerUtil.getLogger("Preloader");

logger.info("Loading..");

// Load ConfigManager
ConfigManager.load();

// Yuck!
// TODO Fix this
DistroAPI["commonDir"] = ConfigManager.getCommonDirectory();
DistroAPI["instanceDir"] = ConfigManager.getInstanceDirectory();

// Load Strings
LangLoader.setupLanguage();

/**
 *
 * @param {HeliosDistribution} data
 */
function onDistroLoad(data) {
  if (data != null) {
    // Resolve the selected server if its value has yet to be set.
    if (
      ConfigManager.getSelectedServer() == null ||
      data.getServerById(ConfigManager.getSelectedServer()) == null
    ) {
      logger.info("Determining default selected server..");
      ConfigManager.setSelectedServer(data.getMainServer().rawServer.id);
      ConfigManager.save();
    }
  }
  ipcRenderer.send("distributionIndexDone", data != null);
}

// Ensure Distribution is downloaded and cached.
DistroAPI.getDistribution()
  .then((heliosDistro) => {
    logger.info("Loaded distribution index.");

    onDistroLoad(heliosDistro);
  })
  .catch((err) => {
    logger.info("Failed to load an older version of the distribution index.");
    logger.info("Application cannot run.");
    logger.error(err);

    onDistroLoad(null);
  });

// Clean up temp dir incase previous launches ended unexpectedly.
fs.remove(
  path.join(os.tmpdir(), ConfigManager.getTempNativeFolder()),
  (err) => {
    if (err) {
      logger.warn("Error while cleaning natives directory", err);
    } else {
      logger.info("Cleaned natives directory.");
    }
  },
);
