let readyPromise = null;

export function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const [{ default: Lang }, ConfigManager] = await Promise.all([
        import("../langloader.js"),
        import("../configmanager.js"),
      ]);

      await Lang.setupLanguage();
      await ConfigManager.load();
    })();
  }

  return readyPromise;
}
