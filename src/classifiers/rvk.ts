import { Classifier, BookMetadata, EnrichedCandidate } from "../types";
import { extractRVKFromMARC } from "../sru";

const RVK_NODE_BASE = "https://rvk.ur.de/api3/json/notation/nodeNt/";
const RVK_SEARCH_BASE = "https://rvk.ur.de/api3/json/notation/nodes/";

// RVK Hauptgruppen (top-level classes) retrieved from the RVK API
const RVK_HAUPTGRUPPEN = `\
A       Allgemeines
B       Theologie und Religionswissenschaften
CA–CK   Philosophie
CL–CZ   Psychologie
D       Pädagogik
E       Allgemeine und vergleichende Sprach- und Literaturwissenschaft; Indogermanistik; Außereuropäische Sprachen und Literaturen
F       Klassische Philologie; Byzantinistik; Mittellateinische und Neugriechische Philologie; Neulatein
G       Germanistik; Niederländische Philologie; Skandinavistik
H       Anglistik; Amerikanistik
I       Romanistik
K       Slawistik; Baltistik; Fennistik
LA–LC   Sozial- und Kulturanthropologie; Empirische Kulturwissenschaft
LD–LG   Klassische Archäologie
LH–LO   Kunstgeschichte
LP–LY   Musikwissenschaft
MA–ML   Politologie
MN–MS   Soziologie
MT      Gesundheitswissenschaften
MX–MZ   Militärwissenschaften
N       Geschichte
P       Rechtswissenschaft
Q       Wirtschaftswissenschaften
R       Geographie
SA–SP   Mathematik
SQ–SU   Informatik
TA–TD   Allgemeine Naturwissenschaften
TE–TZ   Geowissenschaften
U       Physik
V       Chemie und Pharmazie
W       Biologie
X–Y     Medizin
ZA–ZE   Land- und Forstwirtschaft; Gartenbau; Fischerei; Ernährungswissenschaft
ZG–ZS   Technik
ZX–ZY   Sportwissenschaft`;

interface RVKRegisterEntry {
  begriff: string;
}

interface RVKNode {
  notation: string;
  benennung?: string;
  // nodeNt uses "register", nodes uses "Register"
  register?: RVKRegisterEntry | RVKRegisterEntry[];
  Register?: RVKRegisterEntry | RVKRegisterEntry[];
}

interface RVKResponse {
  // single object (nodeNt) or array (nodes); absent on errors ("error-code")
  node?: RVKNode | RVKNode[];
}

function registerTerms(node: RVKNode): string[] {
  const register = node.register ?? node.Register ?? [];
  const entries = Array.isArray(register) ? register : [register];
  return entries.map((e) => e.begriff).filter(Boolean);
}

// Notation → node data, kept for the lifetime of the plugin (until Zotero restarts or the
// plugin is reloaded) so repeated notations don't hit the RVK API again.
// Only successful lookups are cached; failures are retried on the next request.
const nodeCache = new Map<string, EnrichedCandidate>();

/** Returns null if the node could not be retrieved. */
async function fetchNodeDetail(notation: string): Promise<EnrichedCandidate | null> {
  try {
    const url = `${RVK_NODE_BASE}${encodeURIComponent(notation)}`;
    const resp = await Zotero.HTTP.request("GET", url, { timeout: 8000 });
    if (resp.status !== 200) return null;
    const data: RVKResponse = JSON.parse(resp.responseText);
    const node = Array.isArray(data.node) ? data.node[0] : data.node;
    if (!node) return null;
    return { notation, label: node.benennung ?? "", terms: registerTerms(node) };
  } catch {
    return null;
  }
}

async function lookupNode(notation: string): Promise<EnrichedCandidate> {
  const cached = nodeCache.get(notation);
  if (cached) return cached;
  const fetched = await fetchNodeDetail(notation);
  if (!fetched) return { notation, label: "", terms: [] };
  nodeCache.set(notation, fetched);
  return fetched;
}

/**
 * Search RVK nodes by a German keyword (matches Benennung and Register entries).
 * The response already carries Benennung and Register, so the nodes are returned
 * fully enriched — no follow-up detail request is needed for them.
 */
export async function searchRVKByKeyword(keyword: string): Promise<EnrichedCandidate[]> {
  try {
    const url = `${RVK_SEARCH_BASE}${encodeURIComponent(keyword)}`;
    const resp = await Zotero.HTTP.request("GET", url, { timeout: 8000 });
    if (resp.status !== 200) return [];
    // "no match" is answered with a non-JSON error body → JSON.parse throws → []
    const data: RVKResponse = JSON.parse(resp.responseText);
    const nodes = Array.isArray(data.node) ? data.node : data.node ? [data.node] : [];
    const candidates = nodes
      // skip range nodes like "UO 4000 - UO 4100"
      .filter((n) => n.notation && !n.notation.includes("-"))
      .map((n) => ({
        notation: normalizeNotation(n.notation),
        label: n.benennung ?? "",
        terms: registerTerms(n),
      }));
    for (const c of candidates) nodeCache.set(c.notation, c);
    return candidates;
  } catch {
    return [];
  }
}

// Uppercase, collapse internal whitespace to single space, trim
function normalizeNotation(n: string): string {
  return n.trim().toUpperCase().replace(/\s+/, " ");
}

export const rvkClassifier: Classifier = {
  id: "rvk",
  label: "RVK",
  extraKey: "Predicted classes (RVK)",

  extractFromMARC(xml: string): string[] {
    return extractRVKFromMARC(xml);
  },

  async enrichCandidates(
    notations: string[],
    known: EnrichedCandidate[] = []
  ): Promise<EnrichedCandidate[]> {
    const knownByNotation = new Map(known.map((c) => [c.notation, c]));
    // Deduplicate and cap at 15 to limit RVK API calls
    const unique = [...new Set(notations.map(normalizeNotation))].slice(0, 15);
    // Only notations without data (not passed in, not cached) go to the RVK API
    return Promise.all(
      unique.map((n) => knownByNotation.get(n) ?? lookupNode(n))
    );
  },

  keywordPrompt(meta: BookMetadata): string {
    const lines = [
      "Generate 3 to 5 German keywords suitable for searching the RVK (Regensburger Verbundklassifikation) classification system for the following book.",
      "Return ONLY the keywords separated by \" | \" with no other text.",
      "",
      `Title: ${meta.title}`,
      `Author: ${meta.authors.join(", ")}`,
      `Tags: ${meta.tags.join(", ")}`,
    ];
    if (meta.abstract) lines.push(`Abstract: ${meta.abstract}`);
    return lines.join("\n");
  },

  rerankPrompt(meta: BookMetadata, candidates: EnrichedCandidate[], extraInstructions?: string): string {
    const candidateLines = candidates
      .map((c, i) => {
        const terms = c.terms.length ? ` [${c.terms.join(", ")}]` : "";
        return `${i + 1}. ${c.notation}: ${c.label}${terms}`;
      })
      .join("\n");

    const lines = [
      "Select and rank the 3 most appropriate RVK notations for the following book.",
      "Choose ONLY from the numbered candidates listed below.",
      "Return ONLY the 3 candidate numbers separated by \" | \" with no other text. Example: \"2 | 5 | 1\"",
      "",
      "RVK top-level classes (Hauptgruppen) — for context only, do NOT return these as answers:",
      RVK_HAUPTGRUPPEN,
    ];
    if (extraInstructions) lines.push(extraInstructions);
    lines.push(
      "",
      `Title: ${meta.title}`,
      `Author: ${meta.authors.join(", ")}`,
      `Tags: ${meta.tags.join(", ")}`,
    );
    if (meta.abstract) lines.push(`Abstract: ${meta.abstract}`);
    lines.push("", "Candidates:", candidateLines);
    return lines.join("\n");
  },

  validate(notation: string): boolean {
    // RVK notation: 2 uppercase letters + space + digits (+ optional letters/digits)
    // e.g. "ST 110", "AN 93125", "BF 723.S75"
    return /^[A-Z]{2}\s+\S+$/.test(notation.trim());
  },
};
