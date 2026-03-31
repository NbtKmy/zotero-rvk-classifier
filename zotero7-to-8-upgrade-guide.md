# Zotero Plugin Upgrade Guide: Zotero 7 → Zotero 8

Last reviewed: 2026-03-30
Target reader: AI coding assistants (Claude Code), plugin maintainers
Source priority: Official Zotero developer docs and changelog

---

## 1. Goal

Upgrade an existing Zotero plugin that already works on Zotero 7 so that it works on Zotero 8 with the fewest necessary changes.

This is **not** a full Zotero 6 → 7 migration guide.
Zotero 8 mostly keeps the Zotero 7 plugin model, but there are important breaking changes from the underlying Mozilla platform upgrade.

---

## 2. High-level migration strategy

1. **Keep the Zotero 7 plugin structure unless it is already broken.**
2. **Update compatibility metadata first** so the plugin can load in Zotero 8.
3. **Search and replace known breaking APIs** before debugging behavior.
4. **Migrate JSM imports to ESM imports**.
5. **Remove Bluebird/Zotero.spawn patterns** and convert to `async/await`.
6. **Replace manual menu injection with `Zotero.MenuManager` where feasible**.
7. **Retest any citation-dialog integration manually**, because the citation UI changed significantly in Zotero 8.

---

## 3. What changed between Zotero 7 and Zotero 8

### 3.1 Platform baseline changed

- Zotero 7 was based on Mozilla/Firefox changes through **Firefox 115**.
- Zotero 8 adds Mozilla platform changes through **Firefox 140**.
- Zotero says that **most guidance from “Zotero 7 for Developers” is still relevant**.

Implication:
- The plugin architecture is still recognizable.
- Many breakages come from updated Mozilla internals, not from Zotero inventing a totally new plugin system.

### 3.2 Most important breaking areas

1. **JSM → ESM migration**
2. **Bluebird removal**
3. **`Zotero.spawn()` removal**
4. **Some Firefox/XPCOM API removals or signature changes**
5. **New official custom-menu API**
6. **Citation dialog redesign**, which can break DOM-dependent integrations

---

## 4. Compatibility metadata

### 4.1 `manifest.json`

A Zotero 7+ plugin uses `manifest.json` with `applications.zotero`.

Minimal example:

```json
{
  "manifest_version": 2,
  "name": "Your Plugin",
  "version": "1.2.3",
  "applications": {
    "zotero": {
      "id": "your-plugin@example.com",
      "strict_min_version": "7.0",
      "strict_max_version": "8.0.*"
    }
  }
}
```

Notes:
- `applications.zotero` must exist.
- `strict_max_version` should match the latest tested Zotero 8 minor version.
- If your plugin still says `7.0.*`, Zotero 8 may reject it as incompatible even if the code mostly works.

### 4.2 Update manifest

If you distribute updates, make sure the update manifest also allows Zotero 8.

---

## 5. Mandatory code audit checklist

Run these searches across the plugin source tree.

### 5.1 Search for JSM and old import patterns

```bash
grep -R "\.jsm" .
grep -R "ChromeUtils.import" .
grep -R "Services\.jsm" .
```

### 5.2 Search for Bluebird / old async patterns

```bash
grep -R "Zotero\.spawn" .
grep -R "\.map(" .
grep -R "\.each(" .
grep -R "\.filter(" .
grep -R "isPending(" .
grep -R "isResolved(" .
grep -R "cancel(" .
```

Important:
- Normal array `.map()` is fine.
- The dangerous cases are **Bluebird Promise instance methods**.
- Manually inspect hits instead of bulk replacing blindly.

### 5.3 Search for Mozilla API changes known to break in Zotero 8

```bash
grep -R "XPCOMUtils.defineLazyGetter" .
grep -R "addLogin(" .
grep -R "hiddenDOMWindow" .
grep -R "nsIScriptableUnicodeConverter" .
grep -R "nsIOSFileConstantsService" .
grep -R "DataTransfer.*contains" .
grep -R "ZOTERO_CONFIG" .
```

### 5.4 Search for fragile UI integration

```bash
grep -R "citation" .
grep -R "menupopup" .
grep -R "createXULElement" .
grep -R "appendChild" .
grep -R "querySelector" .
```

Use this to find:
- Manual menu injection
- Dialog DOM patching
- Selector-based hooks into Zotero UI

---

## 6. Required migration rules

### Rule 1: Convert JSM modules to ESM

#### Old pattern

```javascript
var { FilePicker } = ChromeUtils.import("chrome://zotero/content/modules/filePicker.jsm");
```

#### New pattern (shape may vary by module)

```javascript
import { FilePicker } from "chrome://zotero/content/modules/filePicker.mjs";
```

Rules:
- `.jsm` becomes `.mjs` or `.sys.mjs` depending on the module.
- Use standard `import` statements.
- **Global imports are no longer supported**.
- Imported modules must be assigned to variables.
- ESM runs in **strict mode**, so sloppy JS that used to pass may now fail.

Action:
- Convert all local plugin modules and imported Zotero/Mozilla modules away from JSM.
- Fix any strict-mode errors revealed after conversion.

### Rule 2: Replace `Zotero.spawn()`

#### Old pattern

```javascript
Zotero.spawn(function* () {
  let items = yield Zotero.Items.getAsync(ids);
  yield doSomething(items);
});
```

#### New pattern

```javascript
(async () => {
  const items = await Zotero.Items.getAsync(ids);
  await doSomething(items);
})();
```

Rules:
- `Zotero.spawn()` is removed.
- Generators used only for async flow should become `async` functions.

### Rule 3: Remove Bluebird-specific Promise methods

Dangerous examples:

```javascript
await promise.map(fn)
await promise.each(fn)
promise.isPending()
promise.cancel()
```

Safer replacements:

#### Sequential work

```javascript
for (const item of items) {
  await fn(item);
}
```

#### Parallel work

```javascript
await Promise.all(items.map(item => fn(item)));
```

Rules:
- Zotero 8 uses standard JavaScript promises.
- `Zotero.Promise.delay()` and `Zotero.Promise.defer()` still exist for compatibility.
- `defer()` can no longer be called as a constructor.
- Complex `isPending()` logic usually needs redesign, not a mechanical replacement.

### Rule 4: Replace `XPCOMUtils.defineLazyGetter`

#### Old

```javascript
XPCOMUtils.defineLazyGetter(this, "foo", () => computeFoo());
```

#### New

```javascript
ChromeUtils.defineLazyGetter(this, "foo", () => computeFoo());
```

### Rule 5: Remove manual `Services.jsm` imports

If your code still imports `Services.jsm` manually, remove that import and switch to the supported access pattern used by current Zotero/Mozilla code.

### Rule 6: Replace `addLogin` with `addLoginAsync`

#### Old

```javascript
loginManager.addLogin(loginInfo);
```

#### New

```javascript
await loginManager.addLoginAsync(loginInfo);
```

### Rule 7: Fix `DataTransfer.types.contains()`

#### Old

```javascript
if (event.dataTransfer.types.contains("text/plain")) {
  // ...
}
```

#### New

```javascript
if (event.dataTransfer.types.includes("text/plain")) {
  // ...
}
```

### Rule 8: Prefer Zotero `FilePicker` wrapper

If your plugin initializes `nsIFilePicker` directly, review that code.
Mozilla changed the expected `init()` usage to pass `BrowsingContext`.
Zotero recommends using Zotero’s own `FilePicker` module instead.

### Rule 9: Import `ZOTERO_CONFIG` explicitly if used

If the plugin references `ZOTERO_CONFIG`, import it explicitly. Do not assume it is globally available.

### Rule 10: Preference panes now have isolated globals

A `var` defined in one preference pane script is no longer automatically visible to other preference panes.

If cross-pane state is required:
- assign it explicitly to `window`, or
- use a shared module/service instead.

### Rule 11: Update button text via property, not attribute

Use:

```javascript
button.label = "Run";
```

Not:

```javascript
button.setAttribute("label", "Run");
```

---

## 7. UI migration guidance

### 7.1 Menus

If the plugin manually injects menu items into Zotero menus, context menus, or toolbar submenus, prefer migrating to:

```javascript
Zotero.MenuManager.registerMenu(...)
```

Why:
- It is now the official API.
- It supports multiple menu targets.
- Zotero automatically removes registered menus when the plugin is disabled or uninstalled.

Good migration candidates:
- Item context menu entries
- Collection context menu entries
- Menubar additions
- Add Note / Add Attachment submenu items
- Reader-window menu additions

### 7.2 Citation dialog integrations are high risk

Zotero 8 replaces the old red-bar citation dialog, classic citation dialog, and Add Note dialog with a unified citation dialog.

Implication:
- Any plugin that depends on old dialog DOM structure, selectors, element IDs, event timing, or text labels should be considered **high risk**.

Required action:
- Retest all citation-related features manually in Zotero 8.
- Avoid patching the citation dialog DOM unless absolutely necessary.
- Expect to rewrite selector-based UI hooks.

### 7.3 Item list / notes / attachments assumptions may be stale

Zotero 8 adds annotations to the items list, opens notes in tabs by default, and changes attachment renaming behavior.

Implication:
- Code that assumes item-tree structure or attachment menu layout may need adjustment.

---

## 8. Recommended Claude Code execution plan

Use this as the working plan for an AI coding agent.

### Phase 1: Metadata and loadability

1. Open `manifest.json`.
2. Update `applications.zotero.strict_max_version` to `8.0.*` or the latest tested `8.x.*`.
3. Update any update manifest compatibility range.
4. Try loading the plugin in Zotero 8.

Success criteria:
- Zotero installs and loads the plugin without immediate compatibility rejection.

### Phase 2: Mechanical migration

1. Convert `.jsm` modules/imports to ESM.
2. Replace `Zotero.spawn()` with `async/await`.
3. Replace Bluebird-only Promise methods.
4. Replace known renamed/removed APIs.

Success criteria:
- No startup errors from import resolution or removed async helpers.

### Phase 3: UI stabilization

1. Migrate menu injection to `Zotero.MenuManager` where practical.
2. Test preferences panes for isolated-global issues.
3. Retest any file picker, drag-and-drop, login manager, or button-label logic.

Success criteria:
- Main UI actions run without console errors.

### Phase 4: Manual high-risk tests

Run these tests in Zotero 8:

1. App startup
2. Plugin initialization and shutdown
3. Item context menu actions
4. Collection context menu actions
5. Reader-window actions
6. Preferences pane open/save flow
7. Import/export or file picker operations
8. Drag-and-drop flow
9. Authentication/storage flow if login manager is used
10. Citation workflow if the plugin touches citation or note insertion

Success criteria:
- No uncaught exceptions
- No missing UI entries
- No broken citation interactions

---

## 9. Common migration patterns

### Pattern A: old generator-based async flow

#### Before

```javascript
function run(ids) {
  return Zotero.spawn(function* () {
    let items = yield Zotero.Items.getAsync(ids);
    yield processItems(items);
  });
}
```

#### After

```javascript
async function run(ids) {
  const items = await Zotero.Items.getAsync(ids);
  await processItems(items);
}
```

### Pattern B: Bluebird collection helper

#### Before

```javascript
await Zotero.Promise.resolve(items).each(async (item) => {
  await processItem(item);
});
```

#### After

```javascript
for (const item of items) {
  await processItem(item);
}
```

### Pattern C: parallel async work

#### Before

```javascript
await somePromise.map(doWork);
```

#### After

```javascript
await Promise.all(items.map(doWork));
```

### Pattern D: menu injection

#### Before

```javascript
const menu = document.getElementById("zotero-itemmenu");
const menuitem = document.createXULElement("menuitem");
menuitem.setAttribute("label", "My Action");
menu.appendChild(menuitem);
```

#### After

```javascript
Zotero.MenuManager.registerMenu({
  menuID: "my-action",
  pluginID: "your-plugin@example.com",
  target: "main/library/item",
  menus: [
    {
      menuType: "menuitem",
      l10nID: "my-action-label",
      onCommand: async (event, context) => {
        const items = context.items || [];
        await runMyAction(items);
      }
    }
  ]
});
```

---

## 10. Triage: what to fix first

If time is limited, use this priority order.

### P0 — must fix before anything works

- `manifest.json` compatibility range
- JSM import failures
- `Zotero.spawn()` usage
- Bluebird-only Promise method usage

### P1 — likely runtime breakage

- `Services.jsm` manual imports
- `addLogin` usage
- `DataTransfer.types.contains()`
- direct `nsIFilePicker` initialization
- `XPCOMUtils.defineLazyGetter`

### P2 — UI robustness

- manual menu injection
- preference-pane global sharing
- button label updates via attributes

### P3 — feature-specific validation

- citation dialog integration
- item-tree / annotation assumptions
- attachment rename workflow assumptions

---

## 11. What Claude Code should avoid doing blindly

1. **Do not bulk replace every `.map()` call**.
   - Many are normal arrays, not Bluebird promises.

2. **Do not assume every `.jsm` becomes the same `.mjs` path automatically**.
   - Verify the actual module path and export shape.

3. **Do not keep DOM patching if an official Zotero API now exists**.
   - Menus are the clearest example.

4. **Do not assume citation-dialog selectors survived Zotero 8**.
   - This area changed a lot.

5. **Do not treat `isPending()` as mechanically replaceable**.
   - Usually it encodes a control-flow design that must be rewritten.

---

## 12. Suggested prompts for Claude Code

### Prompt: migration audit

```text
Audit this Zotero plugin for Zotero 8 compatibility.

Goals:
1. Find all Zotero 7 → 8 migration issues.
2. Categorize them as P0/P1/P2/P3.
3. Propose exact code changes.
4. Do not change behavior unless required for compatibility.
5. Be careful not to confuse Bluebird Promise methods with Array methods.

Check specifically for:
- manifest.json compatibility range
- JSM to ESM migration
- ChromeUtils.import usage
- Zotero.spawn removal
- Bluebird-specific Promise methods
- Services.jsm imports
- addLogin -> addLoginAsync
- DataTransfer.types.contains -> includes
- XPCOMUtils.defineLazyGetter -> ChromeUtils.defineLazyGetter
- direct menu DOM injection that should move to Zotero.MenuManager
- citation dialog DOM dependencies
```

### Prompt: mechanical rewrite

```text
Apply only mechanical Zotero 8 compatibility fixes to this codebase.

Rules:
- Update manifest compatibility for Zotero 8.
- Convert JSM imports/modules to ESM where the replacement is clear.
- Replace Zotero.spawn with async/await.
- Replace Bluebird Promise instance methods with standard promise/iteration patterns.
- Replace known renamed APIs.
- Do not refactor unrelated code.
- Leave comments on any ambiguous conversion instead of guessing.
```

### Prompt: high-risk UI review

```text
Review this Zotero plugin for fragile UI integrations that may break in Zotero 8.

Focus on:
- manual menu injection
- citation dialog hooks
- item tree assumptions
- note window/tab assumptions
- attachment rename workflow assumptions

For each issue:
1. identify the fragile code,
2. explain why Zotero 8 may break it,
3. propose the safest replacement.
```

---

## 13. Minimal verification checklist for a human maintainer

- [ ] Plugin installs in Zotero 8
- [ ] No startup import errors
- [ ] Main commands execute
- [ ] Menus appear where expected
- [ ] Preferences open and save correctly
- [ ] File picker flow works
- [ ] Drag-and-drop flow works
- [ ] Auth/login flow works if applicable
- [ ] Citation-related features tested manually if applicable
- [ ] Disable/uninstall cleans up plugin UI correctly

---

## 14. Official references

1. Zotero 8 for Developers  
   https://www.zotero.org/support/dev/zotero_8_for_developers

2. Zotero 7 for Developers  
   https://www.zotero.org/support/dev/zotero_7_for_developers

3. Zotero Changelog  
   https://www.zotero.org/support/changelog

4. Zotero 8 announcement  
   https://www.zotero.org/blog/zotero-8/

---

## 15. Short summary for AI agents

If a Zotero 7 plugin breaks on Zotero 8, first assume:
1. compatibility metadata is too narrow,
2. JSM imports need to become ESM imports,
3. Bluebird/Zotero.spawn async code must be rewritten,
4. some Mozilla APIs were renamed or removed,
5. any citation-dialog or menu DOM patching is fragile and should be revalidated or replaced.

---

## 16. How plugin maintainers usually handle faster Zotero releases

Do **not** assume that every Zotero release requires a full plugin rewrite.
In practice, maintainers usually reduce upgrade cost by:

1. **Supporting a limited version window** instead of every historical Zotero major version.
2. **Checking compatibility metadata first** before changing code.
3. **Keeping Zotero-specific code isolated** from core logic.
4. **Avoiding fragile DOM patching** and old Mozilla internals when official APIs exist.
5. **Running a small repeatable regression checklist** on each new release.

Working assumption for maintenance:
- Most releases should require either:
  - no code changes,
  - compatibility-range updates only, or
  - a few localized compatibility fixes.
- Full rewrites should be rare and usually indicate heavy dependence on unstable UI internals.

---

## 17. Recommended long-term maintenance policy

Use this section to define project policy explicitly in README or CONTRIBUTING.

### 17.1 Support window

Recommended default:
- Support **current stable Zotero major version**.
- Optionally support **one previous major version** only if the code cost is low.
- Optionally test against **current beta** as an early warning system.

Practical examples:
- Conservative policy: support only latest stable major.
- Balanced policy: support latest stable + previous major.
- Proactive policy: support latest stable + beta, and drop older majors quickly.

Avoid this unless the plugin is very small:
- supporting 3+ Zotero major versions at once,
- preserving old compatibility hacks indefinitely,
- promising compatibility with untested future versions.

### 17.2 Version-compatibility rule

Do not declare compatibility beyond what has actually been tested.

Rule:
- `strict_max_version` should reflect the newest verified Zotero release line.
- When a new Zotero minor/major release appears, first test whether the plugin still works.
- If it works, update compatibility metadata.
- If it does not work, apply the smallest targeted fix set.

### 17.3 Release-response policy

When Zotero publishes a new version, use this default sequence:

1. Install the new Zotero version in a test profile.
2. Check whether incompatibility is only from `manifest.json` / update metadata.
3. Run the smoke tests.
4. If smoke tests pass, publish a compatibility bump.
5. If they fail, classify the breakage:
   - platform/import/runtime,
   - UI/menu,
   - citation/dialog,
   - feature-specific workflow.
6. Fix only the affected layer.

---

## 18. Architecture guidelines for plugins that should survive Zotero 9/10 more easily

### 18.1 Split the plugin into 3 layers

Recommended structure:

```text
core/
  Pure business logic, parsing, transformation, data processing

zotero-adapter/
  Zotero APIs, item access, preferences, reader integration, menus

ui-hooks/
  DOM access, selectors, dialog/window hooks, visual integration
```

Rules:
- `core/` should contain as little Zotero-specific code as possible.
- `zotero-adapter/` should be the only place that knows about Zotero APIs.
- `ui-hooks/` should be small, replaceable, and treated as high-risk.

Why:
- Most version breakage happens in `zotero-adapter/` and `ui-hooks/`.
- Keeping business logic outside those layers makes upgrades much cheaper.

### 18.2 Treat DOM selectors as unstable dependencies

If a feature depends on:
- element IDs,
- CSS selectors,
- menu structure,
- dialog layout,
- child node order,
- visible button labels,

then it should be considered **fragile**.

Rules:
- Put selector-based code in one place.
- Document the Zotero window/view it targets.
- Prefer official APIs over DOM injection whenever possible.
- Add comments marking the code as high-risk for future Zotero versions.

### 18.3 Keep compatibility shims small and explicit

Good pattern:

```javascript
export async function addLoginCompat(loginManager, loginInfo) {
  if (typeof loginManager.addLoginAsync === "function") {
    return loginManager.addLoginAsync(loginInfo);
  }
  return loginManager.addLogin(loginInfo);
}
```

Use shims only when they clearly reduce duplicated branching.
Do not spread version checks across the whole codebase.

### 18.4 Prefer capability checks over version checks

Prefer:

```javascript
if (Zotero.MenuManager?.registerMenu) {
  // new path
}
```

Over:

```javascript
if (zoteroVersion >= 8) {
  // new path
}
```

Why:
- capability checks are usually more robust across minor releases,
- they are easier to delete later,
- they reduce false assumptions about exact version behavior.

Use version checks only when:
- the feature truly maps to a specific version boundary,
- no capability probe is reliable,
- or compatibility metadata must be updated.

### 18.5 Avoid deep reliance on Mozilla internals

Every dependency on low-level Mozilla/XPCOM behavior increases maintenance cost.

Prefer:
- Zotero wrappers,
- official documented developer APIs,
- standard JavaScript APIs,
- isolated compatibility helpers.

Avoid when possible:
- old XPCOM services,
- hidden window assumptions,
- undocumented globals,
- direct platform-specific workarounds spread across many files.

---

## 19. Standard operating procedure for each new Zotero release

Use this as a repeated maintenance playbook.

### 19.1 Fast path

Use this when the plugin is already cleanly structured.

1. Update Zotero test environment.
2. Install the current plugin build.
3. Check whether the plugin is blocked only by compatibility metadata.
4. Run smoke tests:
   - startup,
   - menus,
   - main command,
   - preferences,
   - one representative end-to-end workflow.
5. If all pass, bump compatibility and publish.

### 19.2 Slow path

Use this when smoke tests fail.

1. Capture the first startup/runtime error.
2. Classify the issue:
   - import/module issue,
   - removed async helper,
   - renamed Mozilla API,
   - menu/UI integration,
   - citation dialog,
   - file/auth/drag-drop workflow.
3. Fix the narrowest possible layer.
4. Re-run smoke tests.
5. Only then widen compatibility metadata.

### 19.3 Regression checklist template

Keep a small checklist in the repository, for example:

```text
[ ] installs in latest Zotero
[ ] no startup errors
[ ] main menu actions visible
[ ] item context actions visible
[ ] preferences load/save
[ ] import/export path works
[ ] reader integration works
[ ] citation-related flow tested (if applicable)
```

This checklist should stay short enough to run on every Zotero release.

---

## 20. Suggested Claude Code prompts for ongoing maintenance

### Prompt: new Zotero release triage

```text
A new Zotero release is available. Perform a minimal-maintenance compatibility review for this plugin.

Tasks:
1. Check whether incompatibility is only due to manifest/update metadata.
2. Identify the smallest set of code changes required.
3. Categorize findings into:
   - compatibility metadata only,
   - mechanical runtime fixes,
   - fragile UI fixes,
   - high-risk citation/dialog fixes.
4. Prefer capability checks over version checks where practical.
5. Do not refactor unrelated code.
```

### Prompt: isolate fragile integrations

```text
Refactor this Zotero plugin so that Zotero-specific and DOM-fragile code is isolated.

Goals:
1. Move pure business logic into a core layer.
2. Keep Zotero API interactions in an adapter layer.
3. Keep selector-based UI hooks in a small isolated layer.
4. Add comments identifying code that is high-risk across Zotero upgrades.
5. Do not change user-visible behavior unless necessary.
```

### Prompt: compatibility shim review

```text
Review this plugin for version-compatibility shims.

For each shim:
1. confirm whether it is still needed,
2. replace version checks with capability checks when possible,
3. keep the shim localized,
4. remove dead compatibility branches that only support dropped Zotero versions.
```

---

## 21. Known issues discovered during real migration (zotero-price-lookup, 2026-03-30)

These findings are from an actual Zotero 7 → 8 migration and supplement the general guidance above.

### 21.1 `Zotero.MenuManager.registerMenu` — FTL loading is not automatic

**Problem:** `l10nID` in `registerMenu` sets `data-l10n-id` on the XUL element, but Zotero does NOT automatically load the plugin's FTL file into the window's l10n context. The menu item appears as a blank/black entry.

The MenuManager source contains a commented-out TODO for this feature:

```javascript
// TODO: maybe we can let plugins to load their own l10n files in onShowing
// if (menuData.l10nFiles?.length > 0) {
//   for (let l10nFile of menuData.l10nFiles) {
//     win.MozXULElement.insertFTLIfNeeded(l10nFile);
//   }
// }
```

**Fix:** Call `win.MozXULElement.insertFTLIfNeeded(filename)` yourself in `onMainWindowLoad`, before calling `registerMenu`:

```javascript
function onMainWindowLoad(win) {
  try {
    win.MozXULElement.insertFTLIfNeeded("your-plugin.ftl");
  } catch (e) {
    Zotero.log("FTL insert error: " + e);
  }
  Zotero.MenuManager.registerMenu({ ... });
}
```

### 21.2 FTL filename must be plugin-specific

**Problem:** Generic names like `plugin.ftl` share a global namespace across all plugins and can silently conflict.

**Fix:** Use the plugin ID as the filename, e.g. `zotero-price-lookup.ftl`. Place it at `locale/en-US/zotero-price-lookup.ftl`.

### 21.3 FTL syntax for menu labels requires `.label` attribute form

**Wrong:**
```
zotero-price-lookup-menu-label = Look up price
```

**Correct:**
```
zotero-price-lookup-menu-label =
    .label = Look up price
```

XUL `menuitem` labels must be set via the `.label` attribute in Fluent, not as a message value.

### 21.4 `ItemPaneManager.registerSection` — `setEnabled(false)` sets `hidden="true"`, not `[empty]`

**Problem:** In Zotero 7, hiding a custom section was controlled by the `[empty]` attribute on `item-pane-custom-section`. In Zotero 8, `setEnabled(false)` instead sets `hidden="true"` on the element. Code that only removes `[empty]` to re-show the section will silently fail.

**Context:** `setEnabled` can only be called inside `onItemChange`, which fires on user-initiated item clicks — NOT when `item.saveTx()` is called. So after running classification and saving, the section remains hidden because `setEnabled(true)` was never called for the current item.

**Fix:** When manually making the section visible via DOM manipulation (e.g., from a setTimeout after `saveTx()`), remove BOTH attributes:

```typescript
liveElem.removeAttribute("hidden");  // Zotero 8: setEnabled(false) sets this
liveElem.removeAttribute("empty");   // also remove empty to ensure visibility
```

### 21.5 `Zotero.ProgressWindow` — call `show()` before `startCloseTimer()`

**Wrong:**
```javascript
win.startCloseTimer(3000);
win.show();
```

**Correct:**
```javascript
win.show();
win.startCloseTimer(3000);
```

Calling `startCloseTimer` before `show` causes the dialog to remain open until manually clicked.

---

## 22. Maintainer summary

A healthy Zotero plugin maintenance workflow should look like this:

1. Support a limited Zotero version window.
2. Keep compatibility metadata honest.
3. Isolate Zotero-specific and DOM-fragile code.
4. Prefer official APIs and standard JavaScript over old Mozilla internals.
5. Treat each Zotero release as a small regression check, not a full rewrite.

If a plugin becomes expensive to update on every release, the usual root causes are:
- too much DOM patching,
- too much dependence on undocumented internals,
- business logic mixed directly into Zotero/UI code,
- broad version support kept for too long.
