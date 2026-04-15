/**
 * Lightweight LLM client for AI Eval tools.
 * Uses raw fetch — no SDK dependency.
 * Reads ANTHROPIC_API_KEY from env.
 * Future: add OPENAI_API_KEY, GOOGLE_API_KEY support.
 */

export interface LLMResponse {
  text: string;
  tokens: number;
  model: string;
}

export async function callClaude(
  prompt: string,
  options?: {
    system?: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }
): Promise<LLMResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. Add it to your MCP config env vars.\n" +
      "Get your key at https://console.anthropic.com/settings/keys"
    );
  }
  const model = options?.model ?? "claude-sonnet-4-20250514";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: options?.maxTokens ?? 300,
      temperature: options?.temperature ?? 1.0,
      system: options?.system,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json() as Record<string, unknown>;
  const content = data.content as Array<{ text?: string }> | undefined;
  const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
  return {
    text: content?.[0]?.text ?? "",
    tokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
    model: (data.model as string) ?? model,
  };
}

/**
 * Run a prompt N times and collect responses.
 * Rate-limits to avoid 429s (1 req/sec).
 */
export async function runPromptNTimes(
  prompt: string,
  n: number,
  options?: Parameters<typeof callClaude>[1]
): Promise<LLMResponse[]> {
  const results: LLMResponse[] = [];
  for (let i = 0; i < n; i++) {
    results.push(await callClaude(prompt, options));
    if (i < n - 1) await new Promise(r => setTimeout(r, 1200));
  }
  return results;
}

/**
 * Run a multi-turn conversation (for persona drift / emotional stability tests).
 * Each message is sent sequentially, building context.
 */
export async function runConversation(
  messages: string[],
  options?: {
    system?: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
  }
): Promise<LLMResponse[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set. Add it to your MCP config env vars.\n" +
      "Get your key at https://console.anthropic.com/settings/keys"
    );
  }
  const model = options?.model ?? "claude-sonnet-4-20250514";
  const results: LLMResponse[] = [];
  const conversationMessages: Array<{ role: string; content: string }> = [];

  for (let i = 0; i < messages.length; i++) {
    conversationMessages.push({ role: "user", content: messages[i] });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: options?.maxTokens ?? 300,
        temperature: options?.temperature ?? 0.7,
        system: options?.system,
        messages: conversationMessages,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json() as Record<string, unknown>;
    const content = data.content as Array<{ text?: string }> | undefined;
    const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const text = content?.[0]?.text ?? "";

    conversationMessages.push({ role: "assistant", content: text });

    results.push({
      text,
      tokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
      model: (data.model as string) ?? model,
    });

    if (i < messages.length - 1) await new Promise(r => setTimeout(r, 1200));
  }
  return results;
}
