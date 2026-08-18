import { DistributionAPI } from "helios-core/common";
import { getLauncherDirectory } from "./configmanager.js";

export const REMOTE_DISTRO_URL =
  "https://raw.githubusercontent.com/Redllamaaa/tsmplauncher/master/app/assets/distribution.json";

export const DistroAPI = new DistributionAPI(
  getLauncherDirectory(),
  null, // Injected forcefully by the preloader.
  null, // Injected forcefully by the preloader.
  REMOTE_DISTRO_URL,
  false,
);
