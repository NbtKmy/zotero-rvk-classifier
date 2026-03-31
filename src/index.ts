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
  private _win: (Window & { document: Document }) | null = null;

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
          icon: `${rootURI}addon/content/icons/rvk-sidenav.svg`,
        },
        onItemChange: ({ item, setEnabled, setSectionSummary }: { item: ZoteroItem | null; setEnabled: (v: boolean) => void; setSectionSummary: (s: string) => void }): boolean | void => {
          const extra = (item?.getField("extra") as string | undefined) ?? "";
          const hasResult = extra.includes(`${rvkClassifier.extraKey}:`);
          setEnabled(hasResult);
          if (hasResult) {
            const escapedKey = rvkClassifier.extraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const match = extra.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "m"));
            setSectionSummary(match?.[1]?.trim() ?? "");
            const itemRef = item;
            const itemId = (item as unknown as { id: number })?.id;
            const win = this._win as unknown as Window;
            win?.setTimeout?.(() => {
              const sources = itemId != null ? candidatesRef.get(itemId) : undefined;
              this._writeToSection("rvk-classifier-candidates", itemRef, itemId, sources);
            }, 200);
          }
          return hasResult;
        },
        onRender: (props?: { body?: HTMLElement; item?: ZoteroItem | null; paneID?: string; doc?: Document }): void => {
          try {
            const body = props?.body as HTMLElement | undefined;
            const item = props?.item ?? null;
            const paneID = props?.paneID;
            const ownerDoc = props?.doc ?? body?.ownerDocument ?? (this._win as unknown as { document: Document })?.document;
            const actualBody = this._recoverBody(paneID, body as HTMLElement, ownerDoc);
            if (!actualBody) return;
            const itemId = (item as unknown as { id: number })?.id;
            const sources = itemId != null ? candidatesRef.get(itemId) : undefined;
            if (sources) {
              this._renderContent(actualBody, item, sources);
            } else {
              while (actualBody.firstChild) actualBody.removeChild(actualBody.firstChild);
              const doc2 = actualBody.ownerDocument;
              const msg = doc2.createElementNS("http://www.w3.org/1999/xhtml", "div");
              msg.textContent = "Run classification again to see other candidates.";
              msg.className = "rvk-muted";
              actualBody.appendChild(msg);
            }
          } catch (e) {
            Zotero.log?.(`[rvk-classifier] onRender error: ${e}`);
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
    this._win = win as Window & { document: Document };
    (win as unknown as { MozXULElement?: { insertFTLIfNeeded(id: string): void } })
      .MozXULElement?.insertFTLIfNeeded?.("zotero-rvk-classifier.ftl");
    this._registerMenus();
  }

  private _registerMenus(): void {
    for (const classifier of CLASSIFIERS) {
      (Zotero as unknown as {
        MenuManager: {
          registerMenu(opts: object): void;
        };
      }).MenuManager.registerMenu({
        menuID: `${PLUGIN_ID}-predict-${classifier.id}`,
        pluginID: PLUGIN_ID,
        target: "main/library/item",
        menus: [
          {
            menuType: "menuitem",
            l10nID: `rvk-classifier-menu-predict-${classifier.id}`,
            onCommand: () => this.runClassifier(classifier),
          },
        ],
      });
    }
  }

  onMainWindowUnload(_win: Window): void {
    // Zotero.MenuManager automatically removes registered menus on plugin shutdown.
  }

  private getLLMConfig(): LLMConfig {
    return {
      baseUrl: Zotero.Prefs.get(`${PREF_BASE}.ai.baseUrl`, true) || "http://localhost:11434/v1",
      model: Zotero.Prefs.get(`${PREF_BASE}.ai.model`, true) || "llama3.2",
      apiKey: Zotero.Prefs.get(`${PREF_BASE}.ai.apiKey`, true) || undefined,
    };
  }

  private async runClassifier(classifier: Classifier): Promise<void> {
    Zotero.log?.(`[rvk] runClassifier start win=${this._win ? "ok" : "NULL"}`);
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

    if (success > 0) {
      const win = this._win as unknown as Window;
      win?.setTimeout?.(() => {
        for (const item of items) {
          const id = (item as unknown as { id: number }).id;
          const sources = this._candidates.get(id);
          if (sources) {
            this._writeToSection("rvk-classifier-candidates", item, id, sources);
            break;
          }
        }
      }, 1500);
    }
  }

  /** Recover or create the live body element inside a collapsible-section. */
  private _recoverBody(paneID: string | undefined, body: HTMLElement, ownerDoc: Document | undefined): HTMLElement | null {
    if (body?.parentElement) return body;
    if (!ownerDoc) return body ?? null;

    const allSections = ownerDoc.getElementsByTagName("item-pane-custom-section");

    let liveElem: Element | null = null;
    for (let i = 0; i < allSections.length; i++) {
      const dataPaneValue = allSections[i].getAttribute("data-pane") ?? "";
      if (!paneID || dataPaneValue === paneID || dataPaneValue.endsWith(`-${paneID}`)) {
        liveElem = allSections[i];
        break;
      }
    }
    if (!liveElem) return body ?? null;
    liveElem.removeAttribute("empty");
    liveElem.removeAttribute("hidden");

    let liveBody = liveElem.querySelector?.('[data-type="body"]') as HTMLElement | null;
    if (!liveBody) {
      const csArr = liveElem.getElementsByTagName("collapsible-section");
      if (csArr.length > 0) {
        const cs = csArr[0];
        liveBody = (cs.children?.[1] ?? null) as HTMLElement | null;
        if (!liveBody) {
          const newBody = ownerDoc.createElementNS("http://www.w3.org/1999/xhtml", "div");
          newBody.setAttribute("data-type", "body");
          cs.appendChild(newBody);
          if (!cs.hasAttribute("open")) cs.setAttribute("open", "");
          cs.removeAttribute("empty");
          liveBody = newBody;
        }
      }
    }

    const result = liveBody ?? body;
    const section = result?.parentElement;
    if (section) {
      section.removeAttribute("empty");
      if (!section.hasAttribute("open")) section.toggleAttribute("open", true);
    }
    return result;
  }

  /** Write content to the section body (called deferred, after disconnectedCallback cycle). */
  private _writeToSection(paneID: string | undefined, item: ZoteroItem | null, itemId: number, sources: CandidateSources | undefined): void {
    const doc = (this._win as unknown as { document: Document })?.document;
    if (!doc) return;
    const body = this._recoverBody(paneID, null as unknown as HTMLElement, doc);
    if (!body) return;
    if (sources) {
      this._renderContent(body, item, sources);
    } else {
      while (body.firstChild) body.removeChild(body.firstChild);
      const msg = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      msg.textContent = "Run classification again to see other candidates.";
      msg.className = "rvk-muted";
      body.appendChild(msg);
    }
  }

  /** Render candidate chips into a body element. */
  private _renderContent(body: HTMLElement, item: ZoteroItem | null, sources: CandidateSources): void {
    const doc = body.ownerDocument;

    // Inject stylesheet once per document
    const styleId = "rvk-classifier-styles";
    if (!doc.getElementById(styleId)) {
      const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = styleId;
      style.textContent = `
        .rvk-chip { background:#e0e0e0; color:#222; border-radius:3px; padding:1px 6px; font-family:monospace; font-size:0.85em; }
        @media (prefers-color-scheme:dark) { .rvk-chip { background:#4a4a4a; color:#e0e0e0; } }
        .rvk-group-label { font-size:0.8em; color:#666; margin-top:6px; margin-bottom:2px; }
        @media (prefers-color-scheme:dark) { .rvk-group-label { color:#aaa; } }
        .rvk-muted { color:#999; font-size:0.85em; }
        @media (prefers-color-scheme:dark) { .rvk-muted { color:#777; } }
      `;
      (doc.head ?? doc.documentElement)?.appendChild(style);
    }

    const extra = (item?.getField("extra") as string | undefined) ?? "";
    const escapedKey = rvkClassifier.extraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = extra.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "m"));
    const selected = match?.[1]?.trim() ?? "";
    const selectedNotations = selected ? selected.split("|").map((n) => n.trim()).filter(Boolean) : [];

    while (body.firstChild) body.removeChild(body.firstChild);

    const mkDiv = () => doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    const mkSpan = () => doc.createElementNS("http://www.w3.org/1999/xhtml", "span");

    const appendGroup = (label: string, notations: string[]) => {
      const heading = mkDiv();
      heading.textContent = label;
      heading.className = "rvk-group-label";
      body.appendChild(heading);
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
      body.appendChild(row);
    };

    const unselectedSru = sources.sru.filter((n) => !selectedNotations.includes(n));
    const unselectedRvk = sources.rvk.filter((n) => !selectedNotations.includes(n));

    if (sources.sru.length > 0 || sources.rvk.length > 0) {
      if (sources.sru.length > 0) appendGroup("From library catalogs (SRU):", unselectedSru);
      if (sources.rvk.length > 0) appendGroup("From RVK keyword search:", unselectedRvk);
    } else {
      const msg = mkDiv();
      msg.textContent = "(no other candidates)";
      msg.className = "rvk-muted";
      body.appendChild(msg);
    }
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
