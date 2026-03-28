import "./zotero"; // type stubs
import type { ZoteroItem } from "./zotero";
import { rvkClassifier } from "./classifiers/rvk";
import { predict, CandidateSources } from "./pipeline";
import { setExtraField } from "./extra";
import { Classifier, BookMetadata, LLMConfig } from "./types";

const PLUGIN_ID = "zotero-rvk-classifier@nbtkmy.org";
const PREF_BASE = "extensions.zotero-rvk-classifier";

// All registered classifiers. Add new classifiers here in the future.
const CLASSIFIERS: Classifier[] = [rvkClassifier];

class ZoteroRVKClassifier {
  private rootURI: string;
  private _candidates = new Map<number, CandidateSources>();

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

    const candidatesRef = this._candidates;
    const rootURI = this.rootURI;

    try {
      Zotero.ItemPaneManager.registerSection({
        paneID: "rvk-classifier-candidates",
        pluginID: PLUGIN_ID,
        header: {
          l10nID: "rvk-classifier-section-header",
          icon: `${rootURI}addon/content/icons/rvk.svg`,
        },
        sidenav: {
          l10nID: "rvk-classifier-section-sidenav",
          icon: `${rootURI}addon/content/icons/rvk.svg`,
        },
        onItemChange: ({ item, setEnabled, setSectionSummary }: { item: ZoteroItem | null; setEnabled: (v: boolean) => void; setSectionSummary: (s: string) => void }) => {
          const extra = (item?.getField("extra") as string | undefined) ?? "";
          const hasResult = extra.includes(`${rvkClassifier.extraKey}:`);
          setEnabled(hasResult);
          if (hasResult) {
            const escapedKey = rvkClassifier.extraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const match = extra.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "m"));
            setSectionSummary(match?.[1]?.trim() ?? "");
          }
        },
        onRender: ({ paneID, body, item }: { paneID?: string; body: HTMLElement; item: ZoteroItem | null }) => {
          // Use ownerDocument (not global document — unavailable in IIFE bundle context)
          const ownerDoc = body?.ownerDocument;

          // body passed by Zotero may be detached (disconnectedCallback clears light DOM children).
          // Recover the live body from the DOM, or create a new one inside collapsible-section.
          let actualBody: HTMLElement = body;
          if (!body?.parentElement && ownerDoc) {
            const allCustomSections = ownerDoc.getElementsByTagName("item-pane-custom-section");
            let liveElem: Element | null = null;
            for (let i = 0; i < allCustomSections.length; i++) {
              const el = allCustomSections[i];
              if (!paneID || el.getAttribute("data-pane") === paneID) {
                liveElem = el;
                break;
              }
            }

            if (liveElem) {
              // Try querySelector first (works once body has been inserted)
              let liveBody = liveElem.querySelector?.('[data-type="body"]') as HTMLElement | null;

              // If still missing, find collapsible-section and create the body div
              if (!liveBody) {
                const csArr = liveElem.getElementsByTagName("collapsible-section");
                if (csArr.length > 0) {
                  const cs = csArr[0];
                  liveBody = (cs.children?.[1] ?? null) as HTMLElement | null;
                  if (!liveBody) {
                    // collapsible-section light DOM was cleared — recreate body slot child
                    const newBody = ownerDoc.createElementNS("http://www.w3.org/1999/xhtml", "div");
                    newBody.setAttribute("data-type", "body");
                    cs.appendChild(newBody);
                    if (!cs.hasAttribute("open")) cs.setAttribute("open", "");
                    cs.removeAttribute("empty");
                    liveBody = newBody;
                  }
                }
              }

              if (liveBody) actualBody = liveBody;
            }
          }

          const actualSection = actualBody.parentElement;
          if (actualSection) {
            actualSection.removeAttribute("empty");
            if (!actualSection.hasAttribute("open")) {
              actualSection.toggleAttribute("open", true);
            }
          }

          const doc = actualBody.ownerDocument;
          while (actualBody.firstChild) actualBody.removeChild(actualBody.firstChild);

          // Inject stylesheet once per document for dark/light mode support
          const styleId = "rvk-classifier-styles";
          if (!doc.getElementById(styleId)) {
            const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
            style.id = styleId;
            style.textContent = `
              .rvk-chip {
                background: #e0e0e0; color: #222;
                border-radius: 3px; padding: 1px 6px;
                font-family: monospace; font-size: 0.85em;
              }
              @media (prefers-color-scheme: dark) {
                .rvk-chip { background: #4a4a4a; color: #e0e0e0; }
              }
              .rvk-group-label {
                font-size: 0.8em; color: #666;
                margin-top: 6px; margin-bottom: 2px;
              }
              @media (prefers-color-scheme: dark) {
                .rvk-group-label { color: #aaa; }
              }
              .rvk-muted { color: #999; font-size: 0.85em; }
              @media (prefers-color-scheme: dark) {
                .rvk-muted { color: #777; }
              }
            `;
            (doc.head ?? doc.documentElement)?.appendChild(style);
          }

          const extra = (item?.getField("extra") as string | undefined) ?? "";
          const escapedKey = rvkClassifier.extraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const match = extra.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "m"));
          const selected = match?.[1]?.trim() ?? "";
          const itemId = (item as unknown as { id: number } | null)?.id;
          const sources = itemId != null ? candidatesRef.get(itemId) : undefined;

          const mkDiv = () => doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
          const mkSpan = () => doc.createElementNS("http://www.w3.org/1999/xhtml", "span");

          if (!sources) {
            // Candidates not cached (e.g. after Zotero restart) — prompt re-run
            const msg = mkDiv();
            msg.textContent = "Run classification again to see other candidates.";
            msg.className = "rvk-muted";
            actualBody.appendChild(msg);
          } else {
            // Show only the candidates that were NOT selected by the LLM, grouped by source
            const selectedNotations = selected ? selected.split("|").map((n) => n.trim()).filter(Boolean) : [];
            const unselectedSru = sources.sru.filter((n) => !selectedNotations.includes(n));
            const unselectedRvk = sources.rvk.filter((n) => !selectedNotations.includes(n));

            const appendGroup = (label: string, notations: string[]) => {
              const heading = mkDiv();
              heading.textContent = label;
              heading.className = "rvk-group-label";
              actualBody.appendChild(heading);
              const row = mkDiv();
              row.setAttribute("style", "display:flex;flex-wrap:wrap;gap:4px;");
              for (const n of notations) {
                const chip = mkSpan();
                chip.textContent = n;
                chip.className = "rvk-chip";
                row.appendChild(chip);
              }
              if (notations.length === 0) {
                const none = mkSpan();
                none.textContent = "(none)";
                none.className = "rvk-muted";
                row.appendChild(none);
              }
              actualBody.appendChild(row);
            };

            if (sources.sru.length > 0 || sources.rvk.length > 0) {
              if (sources.sru.length > 0) appendGroup("From library catalogs (SRU):", unselectedSru);
              if (sources.rvk.length > 0) appendGroup("From RVK keyword search:", unselectedRvk);
            } else {
              const msg = mkDiv();
              msg.textContent = "(no other candidates)";
              msg.className = "rvk-muted";
              actualBody.appendChild(msg);
            }
          }
        },
      });
    } catch (e) {
      Zotero.log?.(`[rvk-classifier] registerSection failed: ${e}`);
    }
  }

  shutdown(): void {
    this._candidates.clear();
  }

  onMainWindowLoad(win: Window): void {
    (win as unknown as { MozXULElement?: { insertFTLIfNeeded(id: string): void } })
      .MozXULElement?.insertFTLIfNeeded?.("zotero-rvk-classifier.ftl");
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
