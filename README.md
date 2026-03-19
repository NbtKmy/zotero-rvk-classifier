# zotero-rvk-classifier

A [Zotero 7](https://www.zotero.org/) plugin that predicts [RVK](https://rvk.uni-regensburg.de) (Regensburger Verbundklassifikation) classification notations for books using a local or cloud LLM.

## Features

- Right-click any book item → **Predict classification (RVK)**
- Searches German library catalogs (DNB, B3KAT, SLSP, HBZ, OBVSG, K10PLUS) by ISBN to find existing RVK notations
- Falls back to LLM-generated keyword search when no ISBN is available
- Uses an LLM to re-rank candidates and select the top 3 notations
- Writes results to the item's Extra field: `Predicted classes (RVK): XX 1234 | YY 5678 | ZZ 9012`
- Works with any OpenAI-compatible API (Ollama, LM Studio, OpenAI, OpenRouter, etc.)

## Installation

Download the latest `.xpi` from [Releases](https://github.com/NbtKmy/zotero-rvk-classifier/releases) and install via **Zotero → Tools → Add-ons → Install Add-on from File**.

## Configuration

Open **Zotero → Settings → RVK Classifier** and configure:

| Setting | Default | Description |
|---------|---------|-------------|
| Base URL | `http://localhost:11434/v1` | OpenAI-compatible API endpoint |
| API Key | *(empty)* | Required for cloud services (OpenAI, OpenRouter, etc.) |
| Model | `llama3.2` | Model name |

Use **Fetch models** to list available models from your endpoint.

### Recommended local models (via [Ollama](https://ollama.com))

```bash
ollama pull llama3.1      # good quality, moderate speed
ollama pull qwen2.5:3b   # fast, multilingual
```

### Cloud services

| Service | Base URL | API Key |
|---------|----------|---------|
| OpenAI | `https://api.openai.com/v1` | Required |
| OpenRouter | `https://openrouter.ai/api/v1` | Required |

## How it works

1. **ISBN lookup** — queries 6 German-speaking library catalogs in parallel via SRU/Z39.50 and extracts RVK notations from MARCXML (field 084)
2. **Keyword fallback** — if no ISBN or no results, asks the LLM to generate German RVK search terms and queries the [RVK API](https://rvk.uni-regensburg.de/Portal_API/)
3. **Enrichment** — fetches human-readable labels and index terms for each candidate notation from the RVK API
4. **Re-ranking** — asks the LLM to select and rank the 3 best notations given the book metadata and enriched candidates

## Development

```bash
npm install
npm run build        # compile TypeScript
npm run build:watch  # watch mode
npm run zip          # package as .xpi → dist/
```

Requires Node.js 18+.

## License

MIT
