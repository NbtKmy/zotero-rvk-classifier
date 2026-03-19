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
  log?: (msg: string) => void;
};

declare global {
  const Zotero: ZoteroType;
}
