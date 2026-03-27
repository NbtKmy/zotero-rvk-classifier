var addon;
var chromeHandle;

function startup({ id, version, rootURI }, reason) {
  try {
    var aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"]
      .getService(Ci.amIAddonManagerStartup);
    chromeHandle = aomStartup.registerChrome(
      Services.io.newURI(rootURI + "manifest.json"),
      [
        ["content", "zotero-rvk-classifier", rootURI + "addon/content/"],
        ["locale",  "zotero-rvk-classifier", "en-US", rootURI + "locale/en-US/"],
      ]
    );
    Services.scriptloader.loadSubScript(`${rootURI}addon/content/index.js`);
    addon = new ZoteroRVKClassifier(rootURI);
    addon.startup();

    // Register menu on already-open window (e.g. plugin installed while Zotero running)
    Zotero.initializationPromise.then(() => {
      const win = Services.wm.getMostRecentWindow("navigator:browser");
      if (win) addon.onMainWindowLoad(win);
    });
  } catch (e) {
    Zotero.log("zotero-rvk-classifier startup error: " + e);
  }
}

function shutdown({ id, version, rootURI }, reason) {
  try {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    if (win) addon?.onMainWindowUnload(win);
    addon?.shutdown();
    addon = undefined;
    chromeHandle?.destruct?.();
    chromeHandle = undefined;
  } catch (e) {
    Zotero.log("zotero-rvk-classifier shutdown error: " + e);
  }
}

function install(data, reason) {}
function uninstall(data, reason) {}

function onMainWindowLoad({ window: win }) {
  try {
    addon?.onMainWindowLoad(win);
  } catch (e) {
    Zotero.log("zotero-rvk-classifier onMainWindowLoad error: " + e);
  }
}

function onMainWindowUnload({ window: win }) {
  try {
    addon?.onMainWindowUnload(win);
  } catch (e) {
    Zotero.log("zotero-rvk-classifier onMainWindowUnload error: " + e);
  }
}
