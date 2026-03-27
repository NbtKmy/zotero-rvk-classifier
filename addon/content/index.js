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
      const unique = [...new Set(normalized)].slice(0, 30);
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
      const candidateLines = candidates.map((c) => {
        const terms = c.terms.length ? ` [${c.terms.join(", ")}]` : "";
        return `- ${c.notation}: ${c.label}${terms}`;
      }).join("\n");
      const lines = [
        "Select and rank the 3 most appropriate RVK notations for the following book.",
        'Return ONLY the 3 notations separated by " | " with no other text.'
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
        body: JSON.stringify({ model: config.model, messages })
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
      let rawCandidates = [];
      if (meta.isbn) {
        log(`ISBN: ${meta.isbn} \u2014 querying SRU sources`);
        const xmlList = await fetchMARCXMLByISBN(meta.isbn);
        log(`SRU: got ${xmlList.length} responses`);
        for (const xml of xmlList) {
          const found = classifier.extractFromMARC(xml);
          log(`  extracted ${found.length} notations: ${found.join(", ")}`);
          rawCandidates.push(...found);
        }
      } else {
        log(`No ISBN`);
      }
      if (rawCandidates.length === 0) {
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
        rawCandidates = keywordResults.flat();
        log(`Keyword search candidates: ${rawCandidates.join(", ")}`);
      }
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
      const notations = rerankResponse.split("|").map((n) => n.trim()).filter((n) => classifier.validate(n)).slice(0, 3);
      log(`Valid notations after filter: ${notations.join(", ")}`);
      if (notations.length === 0) {
        return { status: "no_result" };
      }
      return { status: "ok", notations, candidates: enriched.map((c) => c.notation) };
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
      this.rootURI = rootURI;
    }
    startup() {
      Zotero.PreferencePanes.register({
        pluginID: PLUGIN_ID,
        src: "addon/content/prefs.xhtml",
        label: "RVK Classifier",
        scripts: ["addon/content/prefs.js"]
      });
    }
    shutdown() {
      this._candidates.clear();
    }
    onMainWindowLoad(win) {
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
