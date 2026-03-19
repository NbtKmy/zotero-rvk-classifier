# Zotero Plugin Development — Design Document

This file is the master design reference for all Zotero plugins in this project.
**Usage:** Copy this file to each plugin's project folder and use it as the basis for development.
Two plugin projects will be created from this document:
- `zotero-rvk-classifier` — predict RVK notations via LLM

---

## Each Plugin's Project Structure

Each plugin lives in its own project folder with this structure:

```
zotero-[plugin-name]/
├── src/
│   └── index.ts          ← main plugin logic
├── addon/
│   └── content/
│       └── icons/        ← plugin icons (SVG/PNG)
├── locale/
│   └── en-US/
│       └── plugin.ftl    ← Fluent localization strings
├── manifest.json
├── bootstrap.js
├── prefs.js
├── package.json
└── CLAUDE.md             ← this file (copied here)
```

No monorepo. Each plugin is self-contained.

---

## Zotero 7 Plugin Architecture

### manifest.json

```json
{
  "manifest_version": 2,
  "name": "Plugin Display Name",
  "version": "1.0.0",
  "description": "Short description",
  "author": "Author Name",
  "applications": {
    "zotero": {
      "id": "plugin-id@example.org",
      "strict_min_version": "7.0",
      "strict_max_version": "7.0.*",
      "update_url": "https://example.com/update.json"
    }
  }
}
```

- `update_url` is **required** from Zotero 7.0.15+. Use a placeholder for development.
- Plugin ID must be unique (email-style format).

### bootstrap.js — Lifecycle

```javascript
var addon;

function startup({ id, version, rootURI }, reason) {
  Services.scriptloader.loadSubScript(`${rootURI}src/index.js`);
  addon = new ZoteroPlugin(rootURI);
  addon.startup();
}

function shutdown({ id, version, rootURI }, reason) {
  addon?.shutdown();
  addon = undefined;
  // CRITICAL: Zotero 7 supports disable without restart.
  // All DOM changes, observers, menu registrations, pref observers MUST be cleaned up.
}

function install(data, reason) {}
function uninstall(data, reason) {}

function onMainWindowLoad(win) {
  addon?.onMainWindowLoad(win);
}

function onMainWindowUnload(win) {
  addon?.onMainWindowUnload(win);
}
```

### prefs.js — Default Preferences

```javascript
pref("extensions.plugin-id.setting1", "default-value");
pref("extensions.plugin-id.apiKey", "");
```

---

## Key Zotero APIs

### Get Selected Items

```javascript
const items = Zotero.getActiveZoteroPane().getSelectedItems();
const books = items.filter(item => item.itemType === 'book');
```

### Read / Write Extra Field

Custom plugin data is stored in the Extra field as `key: value` pairs (one per line).

```javascript
// Read
function getExtraField(item, key) {
  const extra = item.getField('extra') || '';
  const match = extra.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : null;
}

// Write (preserves other keys)
function setExtraField(item, key, value) {
  let extra = item.getField('extra') || '';
  const line = `${key}: ${value}`;
  const regex = new RegExp(`^${key}:.*$`, 'm');
  extra = regex.test(extra) ? extra.replace(regex, line) : (extra ? `${extra}\n${line}` : line);
  item.setField('extra', extra);
}

// Save
await item.saveTx();
// OR inside Zotero.DB.executeTransaction(): item.save();
```

### Preferences

```javascript
// Third arg true = global (full key with "extensions." prefix)
const val = Zotero.Prefs.get('extensions.plugin-id.myKey', true);
Zotero.Prefs.set('extensions.plugin-id.myKey', 'value', true);

// Observer (unregister in shutdown)
const obsID = Zotero.Prefs.registerObserver('extensions.plugin-id.myKey', newVal => {}, true);
Zotero.Prefs.unregisterObserver(obsID);
```

onMainWindowLoad — Window Type Note
The win object passed to onMainWindowLoad(win) has window type "navigator:browser", not "zotero:main". Verify with: win.document.documentElement.getAttribute('windowtype')



### Context Menu Registration

```javascript
// Call in onMainWindowLoad(win)
Zotero.MenuManager.registerMenu({
  menuID: 'plugin-id-action',
  pluginID: 'plugin-id@example.org',
  target: 'main/library/item',   // right-click on items in library
  menus: [{
    menuType: 'menuitem',
    l10nID: 'plugin-id-menu-label',  // defined in .ftl file
    icon: 'chrome://plugin-id/content/icons/icon.svg',
    onCommand: (event, context) => {
      // context.items = selected items
    }
  }]
});
```

### Progress Notification

```javascript
const win = new Zotero.ProgressWindow({ closeOnClick: true });
win.changeHeadline('Plugin Name');
win.addLines(['Processing...'], ['']);
win.startCloseTimer(3000);
win.show();
```

### HTTP Fetch (inside Zotero plugin context)

```javascript
async function fetchJSON(url, headers = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
```

---

## Shared Pattern: OpenAI-Compatible LLM Client

Both plugins (if using LLM) use this pattern. The endpoint is configurable so users can
use Ollama (default), LM Studio, Jan, OpenAI, OpenRouter, or any compatible service.

```typescript
interface LLMConfig {
  baseUrl: string;  // e.g. "http://localhost:11434/v1"
  model: string;    // e.g. "llama3.2"
  apiKey?: string;  // optional, for cloud services
}

async function chatCompletion(config: LLMConfig, messages: {role: string; content: string}[]) {
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: config.model, messages }),
  });
  const data = await res.json();
  return data.choices[0].message.content as string;
}
```

| Backend | Base URL | API Key |
|---------|----------|---------|
| Ollama (default) | `http://localhost:11434/v1` | Not needed |
| LM Studio | `http://localhost:1234/v1` | Not needed |
| OpenAI | `https://api.openai.com/v1` | Required |
| OpenRouter | `https://openrouter.ai/api/v1` | Required |

---


## Plugin: zotero-rvk-classifier

### Purpose
Predict the top 3 classification notations for a book using an LLM, and write them to the
Extra field. Initially supports RVK only, but the architecture is designed to accommodate
additional classification systems (BK, DDC, LCC, etc.) in the future.

**RVK** is a German library classification system.
Notation examples: `ST 110`, `AN 93125`, `CA 1000`
Reference: https://rvk.uni-regensburg.de

### Trigger
Right-click context menu on selected book items: **"Predict classification"** > **"RVK"**

Each registered classifier adds one entry under the submenu. Only one classifier runs per
invocation (no batch selection).

### Extra Field Keys

Each classifier writes to its own key to avoid conflicts:

```
Predicted classes (RVK): ST 110 | AN 93125 | CA 1000
Predicted classes (BK): 54.51 | 31.80
```

### Classifier Interface

All classifiers implement this interface. RVK is the first concrete implementation.
Future classifiers (BK, DDC, etc.) follow the same contract.

```typescript
interface BookMetadata {
  title: string;
  authors: string[];
  tags: string[];
  isbn?: string;
}

interface EnrichedCandidate {
  notation: string;
  label: string;       // human-readable name (empty string if no API available)
  terms: string[];     // index/register terms (empty array if unavailable)
}

interface Classifier {
  id: string;          // e.g. "rvk", "bk", "ddc"
  label: string;       // menu display name, e.g. "RVK"
  extraKey: string;    // Extra field key, e.g. "Predicted classes (RVK)"

  // Extract notations from a MARCXML string (SRU response)
  extractFromMARC(xml: string): string[];

  // Enrich candidate notations with labels and index terms.
  // Classifiers without a dedicated API return candidates as-is.
  enrichCandidates(notations: string[]): Promise<EnrichedCandidate[]>;

  // LLM prompt: generate German keywords for RVK node search (fallback when no ISBN)
  keywordPrompt(meta: BookMetadata): string;

  // LLM prompt: re-rank enriched candidates and return top 3
  rerankPrompt(meta: BookMetadata, candidates: EnrichedCandidate[]): string;

  // Validate a single notation string (format check)
  validate(notation: string): boolean;
}
```

The plugin's core pipeline is classifier-agnostic: it calls the interface methods in order
and works identically for any registered classifier.

### Preferences

| Key | Default | Description |
|-----|---------|-------------|
| `extensions.zotero-rvk-classifier.ai.baseUrl` | `http://localhost:11434/v1` | OpenAI-compatible API base URL |
| `extensions.zotero-rvk-classifier.ai.model` | `llama3.2` | Model name |
| `extensions.zotero-rvk-classifier.ai.apiKey` | `""` | API key (optional) |

### Sources for prediction


#### Library Data

The plugin searches the library sources wchich include the classifications such as RVK notations. The search query is written with ISBN number.

DNB_BASE     = "https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&recordSchema=MARC21-xml"
B3KAT_BASE   = "http://bvbr.bib-bvb.de:5661/bvb01sru?version=1.1&recordSchema=marcxml&operation=searchRetrieve"
SLSP_BASE    = "https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK?version=1.2&operation=searchRetrieve&recordSchema=marcxml"
HBZ_BASE     = "https://eu04.alma.exlibrisgroup.com/view/sru/49HBZ_NETWORK?version=1.1&operation=searchRetrieve&recordSchema=marcxml"
OBVSG_BASE   = "https://services.obvsg.at/sru/OBV-LIT?version=1.1&operation=searchRetrieve&recordSchema=marcxml"
K10PLUS_BASE = "https://sru.k10plus.de/opac-de-627?version=1.1&operation=searchRetrieve&recordSchema=marcxml"
HEBIS_BASE   = "http://sru.hebis.de/sru/DB=2.1?version=1.1&operation=searchRetrieve&recordSchema=marc21&startRecord=1&recordPacking=xml"

MAX_RECORDS = 10


_VERBUND_FIELD = {
    "DNB":     ("marcxml.isbn", DNB_BASE),
    "B3KAT":   ("marcxml.isbn", B3KAT_BASE),
    "SLSP":    ("alma.isbn",    SLSP_BASE),
    "HBZ":     ("alma.isbn",    HBZ_BASE),
    "OBVSG":   ("alma.isbn",    OBVSG_BASE),
    "K10PLUS": ("pica.isb",     K10PLUS_BASE),
}

The query returns the data in marcxml format.
The classifications can be extracted automatically as follows (in Python):

```python

def extract_notations_from_xml(xml):
    """MARCXML から RVK ノテーション文字列のリストだけ返す（RVK API 呼び出しなし）"""
    soup = BeautifulSoup(xml, "xml")
    notations = []
    for field in soup.find_all("datafield", tag="084"):
        sf2 = field.find("subfield", code="2")
        if sf2 and sf2.text.strip() == "rvk":
            sfa = field.find("subfield", code="a")
            if sfa:
                notations.append(sfa.text.strip())
    return notations
```
The python code should be rewritten into JavaScript.
Warning: Some Notations in this fields are not normalized. 

#### RVK Data

# RVK API
RVK_API    = "https://rvk.uni-regensburg.de/api_neu/json/node/"
RVK_SUFFIX = "?json"

Dokumentation: https://rvk.uni-regensburg.de/Portal_API/


### RVK API

Two endpoints are used:

**1. Node detail by notation** — to enrich candidate notations with human-readable labels and index terms:
```
GET https://rvk.uni-regensburg.de/api_neu/json/node/{notation}?json
```
Returns: `notation`, `benennung` (German label), `has_children`, `register` (index terms)

**2. Node search by keyword** — to find candidate notations from a German keyword:
```
GET https://rvk.uni-regensburg.de/api/xml/nodes/{keyword}
```
Returns: list of nodes, each with `notation`, `benennung`, `register` (XML format)

Documentation: https://rvk.uni-regensburg.de/Portal_API/

### Processing Flow

```
For each selected book item:

  1. Collect metadata: title, author(s), tags

  2. Does the item have an ISBN?
     ├─ YES → Query all SRU libraries in parallel (DNB, B3KAT, SLSP, HBZ, OBVSG, K10PLUS)
     │         Extract RVK notations from MARCXML (datafield 084, subfield 2="rvk", subfield a)
     │         → candidate notations list
     │
     └─ NO  → LLM call ①: generate 3–5 German keywords for RVK search
              → Query /api/xml/nodes/{keyword} for each keyword
              → Extract notations from XML results
              → candidate notations list

  3. Are there any candidates?
     ├─ NO  → setExtraField(item, 'Predicted classes', 'no result')
     │         await item.saveTx() → done
     │
     └─ YES → Enrich each candidate: GET /api_neu/json/node/{notation}?json
              → attach benennung + register terms to each candidate

  4. LLM call ②: re-rank candidates and select top 3
     → Input: book metadata + enriched candidate list
     → Output: 3 notations separated by " | "

  5. setExtraField(item, 'Predicted classes', result)
     await item.saveTx()

6. Show summary progress notification
```

### LLM Call ① — German Keyword Generation (fallback, no ISBN)

```
System:
You are a library classification expert specializing in the Regensburger
Verbundklassifikation (RVK) system. RVK uses German terminology.

User:
Generate 3 to 5 German keywords suitable for searching the RVK classification
system for the following book. Return ONLY the keywords separated by " | " with
no other text.

Title: {title}
Author: {author}
Tags: {tags}
```

Example output: `Quantenfeldtheorie | Eichtheorie | Elementarteilchen`

### LLM Call ② — Re-ranking

```
System:
You are a library classification expert specializing in the Regensburger
Verbundklassifikation (RVK) system.

User:
Select and rank the 3 most appropriate RVK notations for the following book.
Return ONLY the 3 notations separated by " | " with no other text.

Title: {title}
Author: {author}
Tags: {tags}

Candidates:
- {notation}: {benennung} [{register terms}]
- ...
```

Example output: `UO 4060 | UO 4000 | UO 4020`

### Extra Field Result

```
Predicted classes: UO 4060 | UO 4000 | UO 4020
```
or on failure:
```
Predicted classes: no result
```

---

## Development Workflow

### Recommended Build Setup

Use the official template as starting point:
https://github.com/zotero/zotero-plugin-template

```bash
npm install
npm run build        # TypeScript → JS, bundle with esbuild
npm run build:watch  # watch mode
npm run zip          # package as .xpi
```

### Install in Zotero for Development

1. Build the plugin (`npm run build`)
2. Zotero → Tools → Add-ons → Install Add-on from File → select `.xpi`
3. Or use the template's built-in hot-reload support

### Optional: zotero-plugin-toolkit

For complex UI needs (tables, dialogs, etc.):
```bash
npm install zotero-plugin-toolkit
```
Key modules: `ExtraFieldTool`, `ProgressWindowHelper`, `DialogHelper`, `MenuManager`

### TypeScript

- Add Zotero types from the template's `typings/` directory
- Target: `ES2020`

---

## Known Pitfalls (lessons learned)

### bootstrap.js

**`onMainWindowLoad` receives `{ window: win }`, not `win` directly**
```javascript
// WRONG
function onMainWindowLoad(win) { ... }

// CORRECT
function onMainWindowLoad({ window: win }) { ... }
```

**Script path must point to the build output**
```javascript
// WRONG — src/index.js does not exist
Services.scriptloader.loadSubScript(`${rootURI}src/index.js`);

// CORRECT
Services.scriptloader.loadSubScript(`${rootURI}addon/content/index.js`);
```

**Register menus after `Zotero.initializationPromise`**
When a plugin is installed while Zotero is already running, `onMainWindowLoad` is NOT called for the existing window. Always also register inside `initializationPromise.then()`:
```javascript
Zotero.initializationPromise.then(() => {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  if (win) addon.onMainWindowLoad(win);
});
```

### esbuild / bundling

**Do not use `globalName` with IIFE format**
`globalName: "Foo"` creates `var Foo = (() => { ... })()`. Since the IIFE returns `undefined`, the outer `var` overwrites `globalThis.Foo` that was set inside. Remove `globalName` and rely on the explicit `globalThis.MyClass = MyClass` assignment at the end of the bundle.

### Context menu

**`Zotero.MenuManager` is NOT a native Zotero API** — it is part of `zotero-plugin-toolkit`. Without that package, use direct DOM manipulation:
```javascript
const itemmenu = doc.getElementById("zotero-itemmenu");
const menuitem = doc.createXULElement("menuitem");
menuitem.setAttribute("label", "My Action");
menuitem.addEventListener("command", () => { /* ... */ });
itemmenu.appendChild(menuitem);
```
Clean up in `onMainWindowUnload`: `doc.getElementById(menuID)?.remove()`.

### Preference pane

**`src` is loaded as an XUL fragment, not a full HTML document**
`Zotero.PreferencePanes.register` reads `src` as a text string with `Zotero.File.getContentsFromURL()` and injects it into the preferences page as a XUL fragment. Do NOT pass a full HTML document.

**`scripts` are loaded before the fragment is inserted into the DOM**
Do not access DOM elements at the top level of a pref script. Use:
- `preference="extensions.plugin-id.key"` attribute on inputs for automatic pref sync (no JS needed)
- `onload="MyPrefs.init()"` on the root element for post-insert initialization
- `oncommand="MyPrefs.doSomething()"` on buttons

```javascript
// prefs.js — loaded before DOM insertion, so define functions only
var MyPrefs = {
  init() { /* DOM is ready here */ },
  doSomething() { /* called by oncommand */ },
};
```

### HTTP requests

**`fetch()` is blocked in Zotero's chrome context** — use `Zotero.HTTP.request()` instead:
```javascript
// WRONG — fetch() fails silently (CORS/CSP blocked)
const res = await fetch(url);

// CORRECT
const resp = await Zotero.HTTP.request("GET", url, { timeout: 5000 });
// resp.status, resp.responseText

// POST example
const resp = await Zotero.HTTP.request("POST", url, {
  timeout: 0,  // 0 = no timeout (useful for LLM calls)
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
```

### XML parsing (MARCXML)

**`querySelectorAll` is unreliable with default-namespace XML in Gecko**
Use `getElementsByTagNameNS("*", localName)` instead:
```javascript
// WRONG — may return 0 results for namespaced XML
doc.querySelectorAll('datafield[tag="084"]')

// CORRECT
const fields = doc.getElementsByTagNameNS("*", "datafield");
for (const field of Array.from(fields)) {
  if (field.getAttribute("tag") !== "084") continue;
  // ...
}
```


<claude-mem-context>
# Recent Activity

<!-- This section is auto-generated by claude-mem. Edit content outside the tags. -->

*No recent activity*
</claude-mem-context>