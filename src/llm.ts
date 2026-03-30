import { LLMConfig } from "./types";

export async function chatCompletion(
  config: LLMConfig,
  messages: { role: string; content: string }[]
): Promise<string> {
  const resp = await Zotero.HTTP.request(
    "POST",
    `${config.baseUrl}/chat/completions`,
    {
      timeout: 0, // no timeout — LLM inference time is unbounded
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: config.model, messages, temperature: 0 }),
    }
  );
  if (resp.status !== 200) {
    throw new Error(
      `LLM request failed: HTTP ${resp.status} (model="${config.model}", url=${config.baseUrl})\n${resp.responseText?.slice(0, 200) ?? ""}`
    );
  }
  const data = JSON.parse(resp.responseText);
  return data.choices[0].message.content as string;
}
