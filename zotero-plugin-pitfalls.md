# Zotero 7 Plugin Development — Pitfalls

A record of real mistakes made during development. Companion to the design document in CLAUDE.md.

---

## 0. Debugging Log — Failed Hypotheses and Verified Paths

Not just a list of pitfalls, but a record of where time was lost so the same dead ends are not revisited.

---

### Problem: Item pane section does not auto-update after classification

**Symptom:** Right-click → run classifier → Extra field is written successfully. But the custom section (`registerSection`) does not update. It only appears after switching to another item and back.

The root cause was a **`data-pane` attribute prefix mismatch** (see below), but the following hypotheses were tried and rejected before arriving there.

#### Hypotheses tried

| # | Hypothesis | What was tried | Outcome |
|---|-----------|----------------|---------|
| 1 | `saveTx()` re-fires `onRender` | Added logs to verify | **Rejected.** `onItemChange` fires after `saveTx()`, but `onRender` does not — already-selected items are not re-rendered |
| 2 | Can call `.render()` directly on the section element | Called `.render()` on `item-pane-custom-section` | **Rejected.** Method does not exist or is inaccessible |
| 3 | `Zotero.getActiveZoteroPane().selectItem(sameId)` forces re-render | Called selectItem with the same ID | **Rejected.** Completed in 1ms — Zotero treats selection of the same item as a no-op |
| 4 | `Zotero.Notifier.trigger('select', 'item', [id])` forces notification | Fired Notifier manually | **Rejected.** `onRender` does not fire — Notifier's select event is a different layer from UI selection |
| 5 | Writing to body in a `setTimeout(0)` inside `onRender` works | Deferred write inside the onRender callback | **Rejected.** `disconnectedCallback` runs and clears the body again before the write. A lifecycle problem, not a timing problem |
| 6 | Call `_writeToSection` directly after `runClassifier` completes | Called via `setTimeout(200)` | **Promising.** Call confirmed, but `body=null` |
| 7 | `body=null` because `collapsible-section` does not exist yet | Assumed DOM assembly timing issue | **Rejected.** Logs showed `collapsible=1` — the section element was present |
| 8 | `body=null` because of paneID mismatch | Logged the actual `data-pane` attribute value | **Correct.** `pane=zotero-rvk-classifier-nbtkmy-org-rvk-classifier-candidates` — exact equality check was wrong. Fixed by switching to `endsWith` |

#### Lessons

- **`onRender` only fires when the user switches items.** `saveTx()` and Notifier do not re-trigger it. To update the section programmatically, call the write function directly.
- **Log the actual DOM state first.** Several steps were spent tracing call stacks without checking the actual `data-pane` value. Logging attribute values early would have skipped hypotheses 2–7.
- **If `getElementsByTagName` returns 1, the element exists.** The element was present but body was still null — that discrepancy was the final clue pointing to the paneID mismatch.

---

### Problem: FTL section header change not reflected

**Symptom:** Editing a `.ftl` file and reinstalling the plugin does not change the section header string.

**Hypotheses considered:** Code bug, build issue, wrong FTL file path.

**Actual cause:** Zotero caches FTL strings in memory. Reinstalling the plugin does not flush the cache. A **full Zotero restart** is required.

**Lesson:** When text does not change, suspect cache / restart before looking at code.

---

### Frequently referenced resources during debugging

| Resource | Purpose |
|----------|---------|
| `Zotero.log` output (Tools → Developer → Error Console) | Only way to observe DOM state and callback firing |
| Zotero source: `chrome/content/zotero/xpcom/itemPaneManager.jsm` | Understand when `onRender` / `onItemChange` fire |
| Zotero source: `itemPane.js`, `collapsibleSection.js` | Understand `disconnectedCallback` behavior and Light DOM clearing timing |

---

## 1. bootstrap.js

### `onMainWindowLoad` receives `{ window: win }`, not `win` directly

```javascript
// Wrong
function onMainWindowLoad(win) { ... }

// Correct
function onMainWindowLoad({ window: win }) { ... }
```

### Script path must point to build output

```javascript
// Wrong — source file does not exist at runtime
Services.scriptloader.loadSubScript(`${rootURI}src/index.js`);

// Correct
Services.scriptloader.loadSubScript(`${rootURI}addon/content/index.js`);
```

### `onMainWindowLoad` is not called when a plugin is installed into a running Zotero

When a plugin is installed while Zotero is already running, `onMainWindowLoad` does not fire for the existing window. Compensate inside `startup()` using `initializationPromise`:

```javascript
Zotero.initializationPromise.then(() => {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  if (win) addon.onMainWindowLoad(win);
});
```

Do not call `registerSection()` inside this callback (see section 6).

---

## 2. esbuild / Bundling

### Do not use `globalName` with IIFE format

`globalName: "Foo"` generates `var Foo = (() => { ... })()`. Since the IIFE returns `undefined`, the outer `var` overwrites the `globalThis.Foo` that was set inside the bundle.

**Fix:** Remove `globalName` and assign explicitly at the end of the bundle: `globalThis.MyClass = MyClass`.

---

## 3. Context Menu

### `Zotero.MenuManager` is not a native Zotero API

`Zotero.MenuManager` is a utility from `zotero-plugin-toolkit`. Without that package it does not exist. Use direct DOM manipulation instead:

```javascript
// Register in onMainWindowLoad
const itemmenu = doc.getElementById("zotero-itemmenu");
const menuitem = doc.createXULElement("menuitem");
menuitem.id = "my-plugin-action";
menuitem.setAttribute("label", "My Action");
menuitem.addEventListener("command", () => { /* ... */ });
itemmenu.appendChild(menuitem);

// Remove in onMainWindowUnload
doc.getElementById("my-plugin-action")?.remove();
```

---

## 4. Preference Pane

### `src` is loaded as a XUL fragment, not a full HTML document

`Zotero.PreferencePanes.register` reads `src` as a string via `Zotero.File.getContentsFromURL()` and injects it as a XUL fragment into the preferences page. Do not pass a full HTML document.

### `scripts` are loaded before the fragment is inserted into the DOM

JS files listed in `scripts` are evaluated before the fragment exists in the DOM. Do not access DOM elements at the top level.

```javascript
// prefs.js — only define functions; DOM access goes inside init()
var Zotero_MyPrefs = {
  init() { /* DOM is ready here */ },
  doSomething() { /* called by oncommand */ },
};
```

Use the `preference="extensions.plugin-id.key"` attribute on inputs for automatic pref sync without JS.

---

## 5. HTTP Requests

### `fetch()` is blocked in Zotero's chrome context

Due to CSP/CORS restrictions, `fetch()` fails silently. Use `Zotero.HTTP.request()` instead:

```javascript
// Wrong
const res = await fetch(url);

// Correct
const resp = await Zotero.HTTP.request("GET", url, { timeout: 5000 });
// resp.status, resp.responseText

// POST with no timeout (e.g. LLM inference)
const resp = await Zotero.HTTP.request("POST", url, {
  timeout: 0,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
```

---

## 6. ItemPaneManager.registerSection

This area has the most pitfalls.

### Call `registerSection()` synchronously inside `startup()`

Calling `registerSection()` inside `initializationPromise.then()` can result in callbacks (`onRender`, `onItemChange`) never firing. Call it directly inside `startup()`.

### The `body` passed to `onRender` is always detached

**Root cause:** Zotero's `XULElementBase.disconnectedCallback()` calls `replaceChildren()`, clearing the `collapsible-section`'s Light DOM children (including the `[data-type="body"]` div). `ItemPaneCustomSection` holds a stale `this._body` reference pointing to this detached element, which gets passed to `onRender`.

**DOM structure:**

```
item-pane-custom-section[data-pane="..."]
  ├─ collapsible-section    ← renders header via closed shadow root
  │    └─ (Light DOM: body div) ← gets cleared after onRender
  └─ html:style
```

- `collapsible-section.shadowRoot` returns `null` (closed shadow root)
- `childElementCount=0` means Light DOM is empty — body div was removed
- The header is visible because the closed shadow DOM renders it

**Fix:** When `body.parentElement === null`, walk the DOM to recover or recreate the live body:

```typescript
function recoverBody(paneID: string | undefined, ownerDoc: Document): HTMLElement | null {
  const allSections = ownerDoc.getElementsByTagName("item-pane-custom-section");
  let liveElem: Element | null = null;
  for (let i = 0; i < allSections.length; i++) {
    const v = allSections[i].getAttribute("data-pane") ?? "";
    // data-pane is prefixed with sanitized plugin ID — use endsWith
    if (!paneID || v === paneID || v.endsWith(`-${paneID}`)) {
      liveElem = allSections[i];
      break;
    }
  }
  if (!liveElem) return null;

  let liveBody = liveElem.querySelector('[data-type="body"]') as HTMLElement | null;
  if (!liveBody) {
    const csArr = liveElem.getElementsByTagName("collapsible-section");
    if (csArr.length > 0) {
      const cs = csArr[0];
      liveBody = (cs.children?.[1] ?? null) as HTMLElement | null;
      if (!liveBody) {
        // Light DOM fully cleared — create and insert a new body div
        const newBody = ownerDoc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        newBody.setAttribute("data-type", "body");
        cs.appendChild(newBody);
        if (!cs.hasAttribute("open")) cs.setAttribute("open", "");
        cs.removeAttribute("empty");
        liveBody = newBody;
      }
    }
  }

  const section = liveBody?.parentElement;
  if (section) {
    section.removeAttribute("empty");
    if (!section.hasAttribute("open")) section.toggleAttribute("open", true);
  }
  return liveBody;
}
```

### The `data-pane` attribute is prefixed with the sanitized plugin ID

The `paneID` passed to `registerSection` (e.g. `"rvk-classifier-candidates"`) appears in the DOM as:

```
zotero-rvk-classifier-nbtkmy-org-rvk-classifier-candidates
```

Zotero converts the plugin ID (`zotero-rvk-classifier@nbtkmy.org`) by replacing `@` and `.` with `-`, then prepends it. An exact `===` check will never match. Use `endsWith(`-${paneID}`)`.

### `onRender` does not re-fire for the currently selected item

Calling `item.saveTx()` does not trigger `onRender` for the already-selected item. To update the section after processing, call the write function directly with a short delay:

```typescript
// At the end of the classifier run
win?.setTimeout?.(() => {
  this._writeToSection("my-pane-id", item, itemId, sources);
}, 200);
```

The 200ms delay allows the DOM update cycle following `saveTx()` to settle.

---

## 7. DOM Manipulation in XUL Context

### `console` is undefined in XUL context

```typescript
// Wrong
console.log("debug");

// Correct
Zotero.log?.("debug");
```

### `createElement("div")` creates a XUL element, not an HTML element

In XUL context, `document.createElement("div")` creates a XUL `<div>`. Use an explicit namespace for HTML elements:

```typescript
// Wrong
doc.createElement("div")

// Correct
doc.createElementNS("http://www.w3.org/1999/xhtml", "div")
```

### The `document` global is undefined inside an IIFE bundle

When bundled as an IIFE with esbuild, the global `document` is not available. Always access the document via `body.ownerDocument` or `this._win.document`.

### `querySelector` / `querySelectorAll` is unreliable with namespaced XML

For namespace-qualified XML (e.g. MARCXML), `querySelectorAll` may return no results. Prefer `getElementsByTagName` / `getElementsByTagNameNS`:

```typescript
// Wrong — may miss elements in default-namespace XML
doc.querySelectorAll('datafield[tag="084"]')

// Correct
const fields = doc.getElementsByTagNameNS("*", "datafield");
for (const field of Array.from(fields)) {
  if (field.getAttribute("tag") !== "084") continue;
  // ...
}
```

---

## 8. FTL Localization

### Changes to `.ftl` files require a full Zotero restart

Zotero caches FTL strings in memory. Changes to section headers, menu labels, etc. are **not** picked up by reinstalling the plugin — a full Zotero restart is required.

---

## 9. Window Type

### The `win` passed to `onMainWindowLoad` has window type `"navigator:browser"`

The `windowtype` attribute is `"navigator:browser"`, not `"zotero:main"`. Verify with:

```javascript
win.document.documentElement.getAttribute("windowtype"); // → "navigator:browser"
```
