"use strict";
(() => {
  // src/sru.ts
  var SRU_SOURCES = [
    {
      name: "DNB",
      field: "marcxml.isbn",
      base: "https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&recordSchema=MARC21-xml"
    },
    {
      name: "B3KAT",
      field: "marcxml.isbn",
      base: "http://bvbr.bib-bvb.de:5661/bvb01sru?version=1.1&recordSchema=marcxml&operation=searchRetrieve"
    },
    {
      name: "SLSP",
      field: "alma.isbn",
      base: "https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK?version=1.2&operation=searchRetrieve&recordSchema=marcxml"
    },
    {
      name: "HBZ",
      field: "alma.isbn",
      base: "https://eu04.alma.exlibrisgroup.com/view/sru/49HBZ_NETWORK?version=1.1&operation=searchRetrieve&recordSchema=marcxml"
    },
    {
      name: "OBVSG",
      field: "alma.isbn",
      base: "https://services.obvsg.at/sru/OBV-LIT?version=1.1&operation=searchRetrieve&recordSchema=marcxml"
    },
    {
      name: "K10PLUS",
      field: "pica.isb",
      base: "https://sru.k10plus.de/opac-de-627?version=1.1&operation=searchRetrieve&recordSchema=marcxml"
    },
    {
      name: "HEBIS",
      field: "marcxml.isbn",
      base: "http://sru.hebis.de/sru/DB=2.1?version=1.1&operation=searchRetrieve&recordSchema=marc21&startRecord=1&recordPacking=xml"
    }
  ];
  var MAX_RECORDS = 10;
  async function fetchMARCXMLByISBN(isbn) {
    const results = await Promise.allSettled(
      SRU_SOURCES.map(async ({ field, base }) => {
        const query = encodeURIComponent(`${field}=${isbn}`);
        const url = `${base}&query=${query}&maximumRecords=${MAX_RECORDS}`;
        const resp = await Zotero.HTTP.request("GET", url, { timeout: 5e3 });
        if (resp.status !== 200)
          throw new Error(`HTTP ${resp.status}`);
        return resp.responseText;
      })
    );
    return results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  }
  function extractRVKFromMARC(xml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const notations = [];
    const fields = doc.getElementsByTagNameNS("*", "datafield");
    for (const field of Array.from(fields)) {
      if (field.getAttribute("tag") !== "084")
        continue;
      let scheme = "";
      let notation = "";
      for (const sf of Array.from(field.getElementsByTagNameNS("*", "subfield"))) {
        const code = sf.getAttribute("code");
        if (code === "2")
          scheme = sf.textContent?.trim() ?? "";
        if (code === "a")
          notation = sf.textContent?.trim() ?? "";
      }
      if (scheme === "rvk" && notation)
        notations.push(notation);
    }
    return notations;
  }

  // src/classifiers/rvk.ts
  var RVK_NODE_BASE = "https://rvk.uni-regensburg.de/api_neu/json/node/";
  var RVK_SEARCH_BASE = "https://rvk.uni-regensburg.de/api/xml/nodes/";
  var RVK_HAUPTGRUPPEN = `A       Allgemeines
B       Theologie und Religionswissenschaften
CA\u2013CK   Philosophie
CL\u2013CZ   Psychologie
D       P\xE4dagogik
E       Allgemeine und vergleichende Sprach- und Literaturwissenschaft; Indogermanistik; Au\xDFereurop\xE4ische Sprachen und Literaturen
F       Klassische Philologie; Byzantinistik; Mittellateinische und Neugriechische Philologie; Neulatein
G       Germanistik; Niederl\xE4ndische Philologie; Skandinavistik
H       Anglistik; Amerikanistik
I       Romanistik
K       Slawistik; Baltistik; Fennistik
LA\u2013LC   Sozial- und Kulturanthropologie; Empirische Kulturwissenschaft
LD\u2013LG   Klassische Arch\xE4ologie
LH\u2013LO   Kunstgeschichte
LP\u2013LY   Musikwissenschaft
MA\u2013ML   Politologie
MN\u2013MS   Soziologie
MT      Gesundheitswissenschaften
MX\u2013MZ   Milit\xE4rwissenschaften
N       Geschichte
P       Rechtswissenschaft
Q       Wirtschaftswissenschaften
R       Geographie
SA\u2013SP   Mathematik
SQ\u2013SU   Informatik
TA\u2013TD   Allgemeine Naturwissenschaften
TE\u2013TZ   Geowissenschaften
U       Physik
V       Chemie und Pharmazie
W       Biologie
X\u2013Y     Medizin
ZA\u2013ZE   Land- und Forstwirtschaft; Gartenbau; Fischerei; Ern\xE4hrungswissenschaft
ZG\u2013ZS   Technik
ZX\u2013ZY   Sportwissenschaft`;
  async function fetchNodeDetail(notation) {
    try {
      const url = `${RVK_NODE_BASE}${encodeURIComponent(notation)}?json`;
      const resp = await Zotero.HTTP.request("GET", url, { timeout: 8e3 });
      if (resp.status !== 200)
        return { notation, label: "", terms: [] };
      const data = JSON.parse(resp.responseText);
      const register = data.node.register ?? [];
      const terms = Array.isArray(register) ? register : [register];
      return { notation, label: data.node.benennung ?? "", terms };
    } catch {
      return { notation, label: "", terms: [] };
    }
  }
  async function searchRVKByKeyword(keyword) {
    try {
      const url = `${RVK_SEARCH_BASE}${encodeURIComponent(keyword)}`;
      const resp = await Zotero.HTTP.request("GET", url, { timeout: 8e3 });
      if (resp.status !== 200)
        return [];
      const xml = resp.responseText;
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, "application/xml");
      const notations = [];
      for (const node of Array.from(doc.getElementsByTagNameNS("*", "node"))) {
        const n = node.getAttribute("notation");
        if (n && !n.includes("-")) {
          notations.push(n.trim());
        }
      }
      return notations;
    } catch {
      return [];
    }
  }
  var rvkClassifier = {
    id: "rvk",
    label: "RVK",
    extraKey: "Predicted classes (RVK)",
    extractFromMARC(xml) {
      return extractRVKFromMARC(xml);
    },
    async enrichCandidates(notations) {
      const normalized = notations.map(
        (n) => n.trim().toUpperCase().replace(/\s+/, " ")
      );
      const unique = [...new Set(normalized)].slice(0, 15);
      return Promise.all(unique.map(fetchNodeDetail));
    },
    keywordPrompt(meta) {
      const lines = [
        "Generate 3 to 5 German keywords suitable for searching the RVK (Regensburger Verbundklassifikation) classification system for the following book.",
        'Return ONLY the keywords separated by " | " with no other text.',
        "",
        `Title: ${meta.title}`,
        `Author: ${meta.authors.join(", ")}`,
        `Tags: ${meta.tags.join(", ")}`
      ];
      if (meta.abstract)
        lines.push(`Abstract: ${meta.abstract}`);
      return lines.join("\n");
    },
    rerankPrompt(meta, candidates, extraInstructions) {
      const candidateLines = candidates.map((c, i) => {
        const terms = c.terms.length ? ` [${c.terms.join(", ")}]` : "";
        return `${i + 1}. ${c.notation}: ${c.label}${terms}`;
      }).join("\n");
      const lines = [
        "Select and rank the 3 most appropriate RVK notations for the following book.",
        "Choose ONLY from the numbered candidates listed below.",
        'Return ONLY the 3 candidate numbers separated by " | " with no other text. Example: "2 | 5 | 1"',
        "",
        "RVK top-level classes (Hauptgruppen) \u2014 for context only, do NOT return these as answers:",
        RVK_HAUPTGRUPPEN
      ];
      if (extraInstructions)
        lines.push(extraInstructions);
      lines.push(
        "",
        `Title: ${meta.title}`,
        `Author: ${meta.authors.join(", ")}`,
        `Tags: ${meta.tags.join(", ")}`
      );
      if (meta.abstract)
        lines.push(`Abstract: ${meta.abstract}`);
      lines.push("", "Candidates:", candidateLines);
      return lines.join("\n");
    },
    validate(notation) {
      return /^[A-Z]{2}\s+\S+$/.test(notation.trim());
    }
  };

  // src/llm.ts
  async function chatCompletion(config, messages) {
    const resp = await Zotero.HTTP.request(
      "POST",
      `${config.baseUrl}/chat/completions`,
      {
        timeout: 0,
        // no timeout — LLM inference time is unbounded
        headers: {
          "Content-Type": "application/json",
          ...config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}
        },
        body: JSON.stringify({ model: config.model, messages, temperature: 0 })
      }
    );
    if (resp.status !== 200) {
      throw new Error(
        `LLM request failed: HTTP ${resp.status} (model="${config.model}", url=${config.baseUrl})
${resp.responseText?.slice(0, 200) ?? ""}`
      );
    }
    const data = JSON.parse(resp.responseText);
    return data.choices[0].message.content;
  }

  // src/pipeline.ts
  var SYSTEM_PROMPT = "You are a library classification expert specializing in the Regensburger Verbundklassifikation (RVK) system.";
  async function predict(classifier, meta, llmConfig, rerankExtraInstructions) {
    const log = (msg) => Zotero.log?.(`[rvk-classifier] ${msg}`);
    try {
      let sruCandidates = [];
      let rvkCandidates = [];
      if (meta.isbn) {
        log(`ISBN: ${meta.isbn} \u2014 querying SRU sources`);
        const xmlList = await fetchMARCXMLByISBN(meta.isbn);
        log(`SRU: got ${xmlList.length} responses`);
        for (const xml of xmlList) {
          const found = classifier.extractFromMARC(xml);
          log(`  extracted ${found.length} notations: ${found.join(", ")}`);
          sruCandidates.push(...found);
        }
      } else {
        log(`No ISBN`);
      }
      if (sruCandidates.length === 0) {
        log(`No SRU candidates \u2014 trying LLM keyword fallback`);
        const keywordResponse = await chatCompletion(llmConfig, [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: classifier.keywordPrompt(meta) }
        ]);
        log(`LLM keywords: ${keywordResponse}`);
        const keywords = keywordResponse.split("|").map((k) => k.trim()).filter(Boolean).slice(0, 5);
        const keywordResults = await Promise.all(
          keywords.map((kw) => searchRVKByKeyword(kw))
        );
        rvkCandidates = keywordResults.flat();
        log(`Keyword search candidates: ${rvkCandidates.join(", ")}`);
      }
      const rawCandidates = [...sruCandidates, ...rvkCandidates];
      if (rawCandidates.length === 0) {
        log(`No candidates found \u2014 returning no_result`);
        return { status: "no_result" };
      }
      const enriched = await classifier.enrichCandidates(rawCandidates);
      log(`Enriched ${enriched.length} candidates`);
      const rerankResponse = await chatCompletion(llmConfig, [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: classifier.rerankPrompt(meta, enriched, rerankExtraInstructions) }
      ]);
      log(`LLM rerank response: ${rerankResponse}`);
      const notations = rerankResponse.split("|").map((n) => n.trim()).map((token) => {
        const idx = parseInt(token, 10);
        if (!isNaN(idx) && idx >= 1 && idx <= enriched.length) {
          return enriched[idx - 1].notation;
        }
        return classifier.validate(token) ? token : null;
      }).filter((n) => n !== null).slice(0, 3);
      log(`Valid notations after filter: ${notations.join(", ")}`);
      if (notations.length === 0) {
        return { status: "no_result" };
      }
      const enrichedNotations = enriched.map((c) => c.notation);
      const sruSet = new Set(sruCandidates);
      return {
        status: "ok",
        notations,
        candidates: {
          sru: enrichedNotations.filter((n) => sruSet.has(n)),
          rvk: enrichedNotations.filter((n) => !sruSet.has(n))
        }
      };
    } catch (e) {
      return { status: "error", message: String(e) };
    }
  }

  // src/extra.ts
  function setExtraField(item, key, value) {
    let extra = item.getField("extra") || "";
    const line = `${key}: ${value}`;
    const regex = new RegExp(`^${escapeRegex(key)}:.*$`, "m");
    extra = regex.test(extra) ? extra.replace(regex, line) : extra ? `${extra}
${line}` : line;
    item.setField("extra", extra);
  }
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // src/index.ts
  var PLUGIN_ID = "zotero-rvk-classifier@nbtkmy.org";
  var PREF_BASE = "extensions.zotero-rvk-classifier";
  var CLASSIFIERS = [rvkClassifier];
  var ZoteroRVKClassifier = class {
    constructor(rootURI) {
      this._candidates = /* @__PURE__ */ new Map();
      this._win = null;
      this.rootURI = rootURI;
    }
    startup() {
      Zotero.PreferencePanes.register({
        pluginID: PLUGIN_ID,
        src: "addon/content/prefs.xhtml",
        label: "RVK Classifier",
        scripts: ["addon/content/prefs.js"]
      });
      const candidatesRef = this._candidates;
      const rootURI = this.rootURI;
      try {
        Zotero.ItemPaneManager.registerSection({
          paneID: "rvk-classifier-candidates",
          pluginID: PLUGIN_ID,
          header: {
            l10nID: "rvk-classifier-section-header",
            icon: `${rootURI}addon/content/icons/rvk.svg`
          },
          sidenav: {
            l10nID: "rvk-classifier-section-sidenav",
            icon: `${rootURI}addon/content/icons/rvk.svg`
          },
          onItemChange: ({ item, setEnabled, setSectionSummary }) => {
            const extra = item?.getField("extra") ?? "";
            const hasResult = extra.includes(`${rvkClassifier.extraKey}:`);
            setEnabled(hasResult);
            if (hasResult) {
              const escapedKey = rvkClassifier.extraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
              const match = extra.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "m"));
              setSectionSummary(match?.[1]?.trim() ?? "");
            }
          },
          onRender: ({ paneID, body, item }) => {
            const ownerDoc = body?.ownerDocument;
            const itemId = item?.id;
            const sources = itemId != null ? candidatesRef.get(itemId) : void 0;
            if (sources) {
              this._writeToSection(paneID, item, itemId, sources);
              return;
            }
            const actualBody = this._recoverBody(paneID, body, ownerDoc);
            if (!actualBody)
              return;
            const doc = actualBody.ownerDocument;
            while (actualBody.firstChild)
              actualBody.removeChild(actualBody.firstChild);
            const msg = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
            msg.textContent = "Run classification again to see other candidates.";
            msg.className = "rvk-muted";
            actualBody.appendChild(msg);
          }
        });
      } catch (e) {
        Zotero.log?.(`[rvk-classifier] registerSection failed: ${e}`);
      }
    }
    shutdown() {
      this._candidates.clear();
    }
    onMainWindowLoad(win) {
      this._win = win;
      win.MozXULElement?.insertFTLIfNeeded?.("zotero-rvk-classifier.ftl");
      const doc = win.document;
      if (doc.readyState === "complete") {
        this._registerMenus(doc);
      } else {
        win.addEventListener("load", () => this._registerMenus(doc), { once: true });
      }
    }
    _registerMenus(doc) {
      const itemmenu = doc.getElementById("zotero-itemmenu");
      if (!itemmenu)
        return;
      const createEl = (tag) => doc.createXULElement ? doc.createXULElement(tag) : doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", tag);
      for (const classifier of CLASSIFIERS) {
        const menuID = `${PLUGIN_ID}-predict-${classifier.id}`;
        const menuitem = createEl("menuitem");
        menuitem.id = menuID;
        menuitem.setAttribute("label", `Predict classification (${classifier.label})`);
        menuitem.addEventListener("command", () => this.runClassifier(classifier));
        itemmenu.appendChild(menuitem);
      }
    }
    onMainWindowUnload(win) {
      const doc = win.document;
      for (const classifier of CLASSIFIERS) {
        doc.getElementById(`${PLUGIN_ID}-predict-${classifier.id}`)?.remove();
      }
    }
    getLLMConfig() {
      return {
        baseUrl: Zotero.Prefs.get(`${PREF_BASE}.ai.baseUrl`, true) || "http://localhost:11434/v1",
        model: Zotero.Prefs.get(`${PREF_BASE}.ai.model`, true) || "llama3.2",
        apiKey: Zotero.Prefs.get(`${PREF_BASE}.ai.apiKey`, true) || void 0
      };
    }
    async runClassifier(classifier) {
      const items = Zotero.getActiveZoteroPane().getSelectedItems().filter((item) => item.itemType === "book");
      if (items.length === 0)
        return;
      const llmConfig = this.getLLMConfig();
      const rerankExtra = (Zotero.Prefs.get(`${PREF_BASE}.rerank.extraInstructions`, true) || "").trim() || void 0;
      const progress = new Zotero.ProgressWindow({ closeOnClick: false });
      progress.changeHeadline(`RVK Classifier \u2014 ${classifier.label}`);
      progress.addLines([`Processing ${items.length} item(s)\u2026`], [""]);
      progress.show();
      let success = 0;
      let failed = 0;
      let skipped = 0;
      for (const item of items) {
        const meta = extractMetadata(item);
        const result = await predict(classifier, meta, llmConfig, rerankExtra);
        if (result.status === "ok") {
          this._candidates.set(item.id, result.candidates);
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
      progress.startCloseTimer(5e3);
      if (success > 0) {
        const win = this._win;
        win?.setTimeout?.(() => {
          for (const item of items) {
            const id = item.id;
            const sources = this._candidates.get(id);
            if (sources) {
              this._writeToSection("rvk-classifier-candidates", item, id, sources);
              break;
            }
          }
        }, 200);
      }
    }
    /** Recover or create the live body element inside a collapsible-section. */
    _recoverBody(paneID, body, ownerDoc) {
      if (body?.parentElement)
        return body;
      if (!ownerDoc)
        return body ?? null;
      const allSections = ownerDoc.getElementsByTagName("item-pane-custom-section");
      let liveElem = null;
      for (let i = 0; i < allSections.length; i++) {
        const dataPaneValue = allSections[i].getAttribute("data-pane") ?? "";
        if (!paneID || dataPaneValue === paneID || dataPaneValue.endsWith(`-${paneID}`)) {
          liveElem = allSections[i];
          break;
        }
      }
      if (!liveElem)
        return body ?? null;
      let liveBody = liveElem.querySelector?.('[data-type="body"]');
      if (!liveBody) {
        const csArr = liveElem.getElementsByTagName("collapsible-section");
        if (csArr.length > 0) {
          const cs = csArr[0];
          liveBody = cs.children?.[1] ?? null;
          if (!liveBody) {
            const newBody = ownerDoc.createElementNS("http://www.w3.org/1999/xhtml", "div");
            newBody.setAttribute("data-type", "body");
            cs.appendChild(newBody);
            if (!cs.hasAttribute("open"))
              cs.setAttribute("open", "");
            cs.removeAttribute("empty");
            liveBody = newBody;
          }
        }
      }
      const result = liveBody ?? body;
      const section = result?.parentElement;
      if (section) {
        section.removeAttribute("empty");
        if (!section.hasAttribute("open"))
          section.toggleAttribute("open", true);
      }
      return result;
    }
    /** Write candidate chips to the section body (called deferred, after disconnectedCallback). */
    _writeToSection(paneID, item, itemId, sources) {
      const doc = this._win?.document;
      if (!doc)
        return;
      const body = this._recoverBody(paneID, null, doc);
      if (!body)
        return;
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
      const extra = item?.getField("extra") ?? "";
      const escapedKey = rvkClassifier.extraKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = extra.match(new RegExp(`^${escapedKey}:\\s*(.+)$`, "m"));
      const selected = match?.[1]?.trim() ?? "";
      const selectedNotations = selected ? selected.split("|").map((n) => n.trim()).filter(Boolean) : [];
      while (body.firstChild)
        body.removeChild(body.firstChild);
      const mkDiv = () => doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      const mkSpan = () => doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      const appendGroup = (label, notations) => {
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
        if (sources.sru.length > 0)
          appendGroup("From library catalogs (SRU):", unselectedSru);
        if (sources.rvk.length > 0)
          appendGroup("From RVK keyword search:", unselectedRvk);
      } else {
        const msg = mkDiv();
        msg.textContent = "(no other candidates)";
        msg.className = "rvk-muted";
        body.appendChild(msg);
      }
    }
  };
  function extractMetadata(item) {
    const rawISBN = item.getField("ISBN") || "";
    const firstISBN = rawISBN.trim().split(/[\s,;]/)[0];
    const isbn = firstISBN.replace(/-/g, "").replace(/[^0-9X]/gi, "") || void 0;
    const authors = item.getCreators().map(
      (c) => [c.firstName, c.lastName].filter(Boolean).join(" ")
    ).filter(Boolean);
    const tags = item.getTags().map((t) => t.tag);
    const rawAbstract = (item.getField("abstractNote") || "").trim();
    const abstract = rawAbstract ? rawAbstract.slice(0, 600) : void 0;
    return {
      title: item.getField("title"),
      authors,
      tags,
      isbn: isbn || void 0,
      abstract
    };
  }
  globalThis.ZoteroRVKClassifier = ZoteroRVKClassifier;
})();
