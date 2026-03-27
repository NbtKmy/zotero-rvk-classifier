/* Preferences pane logic for zotero-rvk-classifier
 * Loaded via loadSubScript before DOM insertion — do NOT access DOM here.
 * Use onload/oncommand handlers instead. */

var Zotero_RVKPrefs = {
  PREF_BASE: "extensions.zotero-rvk-classifier",

  init() {
    // Called after the pane fragment is inserted into the DOM (onload event on root vbox).
    const textarea = document.getElementById("rvk-extra-instructions");
    if (textarea) {
      textarea.value = Zotero.Prefs.get(`${this.PREF_BASE}.rerank.extraInstructions`, true) || "";
      textarea.addEventListener("input", () => {
        Zotero.Prefs.set(`${this.PREF_BASE}.rerank.extraInstructions`, textarea.value, true);
      });
    }
  },

  async fetchModels() {
    const $ = (id) => document.getElementById(id);

    const baseUrl = $("rvk-base-url").value.trim()
      || Zotero.Prefs.get(`${this.PREF_BASE}.ai.baseUrl`, true)
      || "http://localhost:11434/v1";
    const apiKey = $("rvk-api-key").value.trim()
      || Zotero.Prefs.get(`${this.PREF_BASE}.ai.apiKey`, true)
      || "";

    const btn    = $("rvk-fetch-btn");
    const status = $("rvk-model-status");

    btn.disabled = true;
    status.value = "Fetching…";

    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = (data.data || []).map((m) => m.id).filter(Boolean);
      if (models.length === 0) throw new Error("No models returned");
      status.value = models.join(", ");
    } catch (e) {
      status.value = "Error: " + e.message;
    } finally {
      btn.disabled = false;
    }
  },
};
