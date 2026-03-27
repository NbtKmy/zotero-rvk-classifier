export interface BookMetadata {
  title: string;
  authors: string[];
  tags: string[];
  isbn?: string;
  abstract?: string;
}

export interface EnrichedCandidate {
  notation: string;
  label: string;    // benennung from RVK API, or "" if unavailable
  terms: string[];  // register terms from RVK API, or [] if unavailable
}

export interface Classifier {
  id: string;
  label: string;
  extraKey: string;
  extractFromMARC(xml: string): string[];
  enrichCandidates(notations: string[]): Promise<EnrichedCandidate[]>;
  keywordPrompt(meta: BookMetadata): string;
  rerankPrompt(meta: BookMetadata, candidates: EnrichedCandidate[], extraInstructions?: string): string;
  validate(notation: string): boolean;
}

export interface LLMConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}
