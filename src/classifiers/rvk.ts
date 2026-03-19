import { Classifier, BookMetadata, EnrichedCandidate } from "../types";
import { extractRVKFromMARC } from "../sru";

const RVK_NODE_BASE = "https://rvk.uni-regensburg.de/api_neu/json/node/";
const RVK_SEARCH_BASE = "https://rvk.uni-regensburg.de/api/xml/nodes/";

interface RVKNodeResponse {
  node: {
    notation: string;
    benennung: string;
    register?: string | string[];
  };
}

async function fetchNodeDetail(notation: string): Promise<EnrichedCandidate> {
  try {
    const url = `${RVK_NODE_BASE}${encodeURIComponent(notation)}?json`;
    const resp = await Zotero.HTTP.request("GET", url, { timeout: 8000 });
    if (resp.status !== 200) return { notation, label: "", terms: [] };
    const data: RVKNodeResponse = JSON.parse(resp.responseText);
    const register = data.node.register ?? [];
    const terms = Array.isArray(register) ? register : [register];
    return { notation, label: data.node.benennung ?? "", terms };
  } catch {
    return { notation, label: "", terms: [] };
  }
}

/**
 * Search RVK nodes by a German keyword.
 * Returns notation strings found in the XML response.
 */
export async function searchRVKByKeyword(keyword: string): Promise<string[]> {
  try {
    const url = `${RVK_SEARCH_BASE}${encodeURIComponent(keyword)}`;
    const resp = await Zotero.HTTP.request("GET", url, { timeout: 8000 });
    if (resp.status !== 200) return [];
    const xml = resp.responseText;
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const notations: string[] = [];
    for (const node of Array.from(doc.querySelectorAll("node"))) {
      const n = node.getAttribute("notation");
      if (n && !n.includes("-")) {
        // skip range nodes like "UO 4000 - UO 4100"
        notations.push(n.trim());
      }
    }
    return notations;
  } catch {
    return [];
  }
}

export const rvkClassifier: Classifier = {
  id: "rvk",
  label: "RVK",
  extraKey: "Predicted classes (RVK)",

  extractFromMARC(xml: string): string[] {
    return extractRVKFromMARC(xml);
  },

  async enrichCandidates(notations: string[]): Promise<EnrichedCandidate[]> {
    // Deduplicate and cap at 30 to limit RVK API calls
    const unique = [...new Set(notations)].slice(0, 30);
    return Promise.all(unique.map(fetchNodeDetail));
  },

  keywordPrompt(meta: BookMetadata): string {
    return [
      "Generate 3 to 5 German keywords suitable for searching the RVK (Regensburger Verbundklassifikation) classification system for the following book.",
      "Return ONLY the keywords separated by \" | \" with no other text.",
      "",
      `Title: ${meta.title}`,
      `Author: ${meta.authors.join(", ")}`,
      `Tags: ${meta.tags.join(", ")}`,
    ].join("\n");
  },

  rerankPrompt(meta: BookMetadata, candidates: EnrichedCandidate[]): string {
    const candidateLines = candidates
      .map((c) => {
        const terms = c.terms.length ? ` [${c.terms.join(", ")}]` : "";
        return `- ${c.notation}: ${c.label}${terms}`;
      })
      .join("\n");

    return [
      "Select and rank the 3 most appropriate RVK notations for the following book.",
      "Return ONLY the 3 notations separated by \" | \" with no other text.",
      "",
      `Title: ${meta.title}`,
      `Author: ${meta.authors.join(", ")}`,
      `Tags: ${meta.tags.join(", ")}`,
      "",
      "Candidates:",
      candidateLines,
    ].join("\n");
  },

  validate(notation: string): boolean {
    // RVK notation: 2 uppercase letters + space + digits (+ optional letters/digits)
    // e.g. "ST 110", "AN 93125", "BF 723.S75"
    return /^[A-Z]{2}\s+\S+$/.test(notation.trim());
  },
};
