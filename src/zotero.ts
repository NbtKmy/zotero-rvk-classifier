// Minimal Zotero type stubs (real types come from zotero-types package)
// ZoteroItem is exported for use in index.ts

export interface ZoteroItem {
  itemType: string;
  getField(field: string): string;
  getTags(): { tag: string }[];
  getCreators(): { firstName?: string; lastName?: string }[];
  setField(field: string, value: string): void;
  saveTx(): Promise<void>;
}

export type ZoteroType = {
  getActiveZoteroPane(): { getSelectedItems(): ZoteroItem[] };
  HTTP: {
    request(
      method: string,
      url: string,
      options?: { timeout?: number; headers?: Record<string, string>; body?: string }
    ): Promise<{ status: number; responseText: string }>;
  };
  Prefs: {
    get(key: string, global: boolean): string;
  };
  ProgressWindow: new (opts: { closeOnClick: boolean }) => {
    changeHeadline(s: string): void;
    addLines(lines: string[], icons: string[]): void;
    startCloseTimer(ms: number): void;
    show(): void;
  };
  PreferencePanes: {
    register(opts: { pluginID: string; src: string; label: string; image?: string; scripts?: string[]; stylesheets?: string[] }): void;
  };
  ItemPaneManager: {
    registerSection(opts: {
      paneID: string;
      pluginID: string;
      header: { l10nID: string; icon: string; darkIcon?: string };
      sidenav: { l10nID: string; icon: string; darkIcon?: string };
      bodyXHTML?: string;
      onInit?: (props: { body: HTMLElement; item: ZoteroItem | null; refresh: () => Promise<void> }) => void;
      onItemChange?: (props: { paneID?: string; doc?: Document; body?: HTMLElement; item: ZoteroItem | null; setEnabled: (v: boolean) => void; setSectionSummary: (s: string) => void }) => boolean | void;
      onRender?: (props: { paneID?: string; doc?: Document; body: HTMLElement; item: ZoteroItem | null }) => void;
      onAsyncRender?: (props: { paneID?: string; doc?: Document; body: HTMLElement; item: ZoteroItem | null }) => Promise<void>;
      onDestroy?: (props: Record<string, unknown>) => void;
    }): void;
  };
  log?: (msg: string) => void;
};

declare global {
  const Zotero: ZoteroType;
}
