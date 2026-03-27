import { Classifier, BookMetadata, LLMConfig } from "./types";
import { chatCompletion } from "./llm";
import { fetchMARCXMLByISBN } from "./sru";
import { searchRVKByKeyword } from "./classifiers/rvk";

const SYSTEM_PROMPT =
  "You are a library classification expert specializing in the Regensburger Verbundklassifikation (RVK) system.";

export type PredictionResult =
  | { status: "ok"; notations: string[]; candidates: string[] }
  | { status: "no_result" }
  | { status: "error"; message: string };

export async function predict(
  classifier: Classifier,
  meta: BookMetadata,
  llmConfig: LLMConfig,
  rerankExtraInstructions?: string
): Promise<PredictionResult> {
  const log = (msg: string) => Zotero.log?.(`[rvk-classifier] ${msg}`);

  try {
    // --- Step 1: gather candidate notations ---
    let rawCandidates: string[] = [];

    if (meta.isbn) {
      log(`ISBN: ${meta.isbn} — querying SRU sources`);
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

    // Fallback: LLM keyword → RVK node search
    if (rawCandidates.length === 0) {
      log(`No SRU candidates — trying LLM keyword fallback`);
      const keywordResponse = await chatCompletion(llmConfig, [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: classifier.keywordPrompt(meta) },
      ]);
      log(`LLM keywords: ${keywordResponse}`);

      const keywords = keywordResponse
        .split("|")
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 5);

      const keywordResults = await Promise.all(
        keywords.map((kw) => searchRVKByKeyword(kw))
      );
      rawCandidates = keywordResults.flat();
      log(`Keyword search candidates: ${rawCandidates.join(", ")}`);
    }

    if (rawCandidates.length === 0) {
      log(`No candidates found — returning no_result`);
      return { status: "no_result" };
    }

    // --- Step 2: enrich candidates ---
    const enriched = await classifier.enrichCandidates(rawCandidates);
    log(`Enriched ${enriched.length} candidates`);

    // --- Step 3: LLM re-rank ---
    const rerankResponse = await chatCompletion(llmConfig, [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: classifier.rerankPrompt(meta, enriched, rerankExtraInstructions) },
    ]);
    log(`LLM rerank response: ${rerankResponse}`);

    const notations = rerankResponse
      .split("|")
      .map((n) => n.trim())
      .filter((n) => classifier.validate(n))
      .slice(0, 3);
    log(`Valid notations after filter: ${notations.join(", ")}`);

    if (notations.length === 0) {
      return { status: "no_result" };
    }

    return { status: "ok", notations, candidates: enriched.map((c) => c.notation) };
  } catch (e) {
    return { status: "error", message: String(e) };
  }
}
