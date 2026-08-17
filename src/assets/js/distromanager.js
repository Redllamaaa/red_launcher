import { DistributionAPI } from "helios-core/common";
import ConfigManager from "./configmanager";

exports.REMOTE_DISTRO_URL =
  "https://raw.githubusercontent.com/Redllamaaa/tsmplauncher/master/app/assets/distribution.json";

const api = new DistributionAPI(
  ConfigManager.getLauncherDirectory(),
  null, // Injected forcefully by the preloader.
  null, // Injected forcefully by the preloader.
  exports.REMOTE_DISTRO_URL,
  false,
);

exports.DistroAPI = api;
