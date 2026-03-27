import "./zotero"; // type stubs
import type { ZoteroItem } from "./zotero";
import { rvkClassifier } from "./classifiers/rvk";
import { predict } from "./pipeline";
import { setExtraField } from "./extra";
import { Classifier, BookMetadata, LLMConfig } from "./types";

const PLUGIN_ID = "zotero-rvk-classifier@nbtkmy.org";
const PREF_BASE = "extensions.zotero-rvk-classifier";

// All registered classifiers. Add new classifiers here in the future.
const CLASSIFIERS: Classifier[] = [rvkClassifier];

class ZoteroRVKClassifier {
  private rootURI: string;
  private _candidates = new Map<number, string[]>();

  constructor(rootURI: string) {
    this.rootURI = rootURI;
  }

  startup(): void {
    Zotero.PreferencePanes.register({
      pluginID: PLUGIN_ID,
      src: "addon/content/prefs.xhtml",
      label: "RVK Classifier",
      scripts: ["addon/content/prefs.js"],
    });

  }

  shutdown(): void {
    this._candidates.clear();
  }

  onMainWindowLoad(win: Window): void {
    const doc = (win as unknown as { document: Document }).document;
    if (doc.readyState === "complete") {
      this._registerMenus(doc);
    } else {
      win.addEventListener("load", () => this._registerMenus(doc), { once: true });
    }
  }

  private _registerMenus(doc: Document): void {
    const itemmenu = doc.getElementById("zotero-itemmenu");
    if (!itemmenu) return;

    const createEl = (tag: string): Element =>
      (doc as unknown as { createXULElement?: (tag: string) => Element }).createXULElement
        ? (doc as unknown as { createXULElement: (tag: string) => Element }).createXULElement(tag)
        : doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tag);

    for (const classifier of CLASSIFIERS) {
      const menuID = `${PLUGIN_ID}-predict-${classifier.id}`;
      const menuitem = createEl("menuitem");
      menuitem.id = menuID;
      menuitem.setAttribute("label", `Predict classification (${classifier.label})`);
      menuitem.addEventListener("command", () => this.runClassifier(classifier));
      itemmenu.appendChild(menuitem);
    }
  }

  onMainWindowUnload(win: Window): void {
    const doc = (win as unknown as { document: Document }).document;
    for (const classifier of CLASSIFIERS) {
      doc.getElementById(`${PLUGIN_ID}-predict-${classifier.id}`)?.remove();
    }
  }

  private getLLMConfig(): LLMConfig {
    return {
      baseUrl: Zotero.Prefs.get(`${PREF_BASE}.ai.baseUrl`, true) || "http://localhost:11434/v1",
      model: Zotero.Prefs.get(`${PREF_BASE}.ai.model`, true) || "llama3.2",
      apiKey: Zotero.Prefs.get(`${PREF_BASE}.ai.apiKey`, true) || undefined,
    };
  }

  private async runClassifier(classifier: Classifier): Promise<void> {
    const items = Zotero.getActiveZoteroPane()
      .getSelectedItems()
      .filter((item) => item.itemType === "book");

    if (items.length === 0) return;

    const llmConfig = this.getLLMConfig();
    const rerankExtra = (Zotero.Prefs.get(`${PREF_BASE}.rerank.extraInstructions`, true) as string || "").trim() || undefined;
    const progress = new Zotero.ProgressWindow({ closeOnClick: false });
    progress.changeHeadline(`RVK Classifier — ${classifier.label}`);
    progress.addLines([`Processing ${items.length} item(s)…`], [""]);
    progress.show();

    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of items) {
      const meta = extractMetadata(item);
      const result = await predict(classifier, meta, llmConfig, rerankExtra);

      if (result.status === "ok") {
        this._candidates.set((item as unknown as { id: number }).id, result.candidates);
        setExtraField(item, classifier.extraKey, result.notations.join(" | "));
        await item.saveTx();
        success++;
      } else if (result.status === "no_result") {
        setExtraField(item, classifier.extraKey, "no result");
        await item.saveTx();
        skipped++;
      } else {
        Zotero.log?.(`[rvk-classifier] Error on "${meta.title}": ${result.message}`);
        failed++;
      }
    }

    progress.addLines(
      [`Done: ${success} updated, ${failed} failed, ${skipped} no result`],
      [""]
    );
    progress.startCloseTimer(5000);
  }
}

function extractMetadata(item: ZoteroItem): BookMetadata {
  // Take only the first ISBN (field may contain multiple separated by spaces/newlines)
  const rawISBN = item.getField("ISBN") || "";
  const firstISBN = rawISBN.trim().split(/[\s,;]/)[0];
  const isbn = firstISBN.replace(/-/g, "").replace(/[^0-9X]/gi, "") || undefined;
  const authors = item
    .getCreators()
    .map((c: { firstName?: string; lastName?: string }) =>
      [c.firstName, c.lastName].filter(Boolean).join(" ")
    )
    .filter(Boolean);
  const tags = item.getTags().map((t: { tag: string }) => t.tag);

  const rawAbstract = (item.getField("abstractNote") || "").trim();
  const abstract = rawAbstract ? rawAbstract.slice(0, 600) : undefined;

  return {
    title: item.getField("title"),
    authors,
    tags,
    isbn: isbn || undefined,
    abstract,
  };
}

// Export for bootstrap.js
(globalThis as unknown as Record<string, unknown>).ZoteroRVKClassifier = ZoteroRVKClassifier;
