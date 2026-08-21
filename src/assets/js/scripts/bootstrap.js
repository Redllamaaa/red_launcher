let readyPromise = null;

export function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const [{ default: Lang }, ConfigManager, { initLogging }] =
        await Promise.all([
          import("../langloader.js"),
          import("../configmanager.js"),
          import("./loggerutil.js"),
        ]);

      await initLogging();
      await Lang.setupLanguage();
      await ConfigManager.load();
    })();
  }

  return readyPromise;
}
