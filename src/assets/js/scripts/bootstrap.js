import Lang from "../langloader.js";
import * as ConfigManager from "../configmanager.js";

let readyPromise = null;

export function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await Lang.setupLanguage();
      await ConfigManager.load();
    })();
  }
  return readyPromise;
}
