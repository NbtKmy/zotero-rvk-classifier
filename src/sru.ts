// SRU library endpoints
const SRU_SOURCES: { name: string; field: string; base: string }[] = [
  {
    name: "DNB",
    field: "marcxml.isbn",
    base: "https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&recordSchema=MARC21-xml",
  },
  {
    name: "B3KAT",
    field: "marcxml.isbn",
    base: "http://bvbr.bib-bvb.de:5661/bvb01sru?version=1.1&recordSchema=marcxml&operation=searchRetrieve",
  },
  {
    name: "SLSP",
    field: "alma.isbn",
    base: "https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK?version=1.2&operation=searchRetrieve&recordSchema=marcxml",
  },
  {
    name: "HBZ",
    field: "alma.isbn",
    base: "https://eu04.alma.exlibrisgroup.com/view/sru/49HBZ_NETWORK?version=1.1&operation=searchRetrieve&recordSchema=marcxml",
  },
  {
    name: "OBVSG",
    field: "alma.isbn",
    base: "https://services.obvsg.at/sru/OBV-LIT?version=1.1&operation=searchRetrieve&recordSchema=marcxml",
  },
  {
    name: "K10PLUS",
    field: "pica.isb",
    base: "https://sru.k10plus.de/opac-de-627?version=1.1&operation=searchRetrieve&recordSchema=marcxml",
  },
  {
    name: "HEBIS",
    field: "marcxml.isbn",
    base: "http://sru.hebis.de/sru/DB=2.1?version=1.1&operation=searchRetrieve&recordSchema=marc21&startRecord=1&recordPacking=xml",
  },
];

const MAX_RECORDS = 10;

/**
 * Query all SRU sources in parallel by ISBN and collect all returned MARCXML strings.
 * Uses Zotero.HTTP.request() which bypasses CORS and CSP restrictions in the plugin context.
 */
export async function fetchMARCXMLByISBN(isbn: string): Promise<string[]> {
  const results = await Promise.allSettled(
    SRU_SOURCES.map(async ({ field, base }) => {
      const query = encodeURIComponent(`${field}=${isbn}`);
      const url = `${base}&query=${query}&maximumRecords=${MAX_RECORDS}`;
      const resp = await Zotero.HTTP.request("GET", url, { timeout: 5000 });
      if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
      return resp.responseText;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);
}

/**
 * Extract RVK notations from a MARCXML string.
 * Uses getElementsByTagNameNS("*", ...) to handle default-namespace XML reliably.
 */
export function extractRVKFromMARC(xml: string): string[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const notations: string[] = [];

  const fields = doc.getElementsByTagNameNS("*", "datafield");
  for (const field of Array.from(fields)) {
    if (field.getAttribute("tag") !== "084") continue;
    let scheme = "";
    let notation = "";
    for (const sf of Array.from(field.getElementsByTagNameNS("*", "subfield"))) {
      const code = sf.getAttribute("code");
      if (code === "2") scheme = sf.textContent?.trim() ?? "";
      if (code === "a") notation = sf.textContent?.trim() ?? "";
    }
    if (scheme === "rvk" && notation) notations.push(notation);
  }

  return notations;
}
