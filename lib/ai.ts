/**
 * Multi-provider AI layer with privacy guardrails.
 *
 * Providers (first configured key wins, order = free-tier preference):
 *   gemini     GEMINI_API_KEY      — Google AI free tier
 *   groq       GROQ_API_KEY        — Groq free tier (already used by the app)
 *   openrouter OPENROUTER_API_KEY  — OpenRouter free models
 *   nvidia     NVIDIA_API_KEY       — NVIDIA NIM hosted endpoints
 *
 * With no key the layer returns null and every caller falls back to its
 * deterministic practice-data engine — the product never depends on a network
 * call to function.
 *
 * Privacy rules enforced here (see REPORT.md §AI privacy):
 *   - `ai_enabled` setting gates all calls; off means nothing ever leaves.
 *   - `redactIdentifiers` strips PAN/GSTIN-shaped tokens from anything we send,
 *     so statutory identifiers never reach a model provider.
 *   - Callers send aggregate context only (counts, due dates, amounts);
 *     document contents and credential numbers are never included.
 *   - We instruct providers not to log/store prompts beyond inference.
 */
import { getSettings } from "./db";

export type ProviderId = "gemini" | "groq" | "openrouter" | "nvidia";

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  model: string;
  envKey: string;
  privacyUrl: string;
};

type ProviderSpec = {
  label: string;
  envKey: string;
  fallbackKeys: string[];
  modelEnv: string;
  defaultModel: string;
  privacyUrl: string;
  /** Optional origin override (e.g. an OpenAI-compatible gateway or a mock for tests). */
  baseUrlEnv: string;
  defaultBase: string;
};

const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  gemini: {
    label: "Google Gemini",
    envKey: "GEMINI_API_KEY",
    fallbackKeys: ["GOOGLE_AI_API_KEY"],
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
    privacyUrl: "https://ai.google.dev/users/privacy",
    baseUrlEnv: "GEMINI_BASE_URL",
    defaultBase: "https://generativelanguage.googleapis.com",
  },
  groq: {
    label: "Groq",
    envKey: "GROQ_API_KEY",
    fallbackKeys: [],
    modelEnv: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
    privacyUrl: "https://groq.com/privacy",
    baseUrlEnv: "GROQ_BASE_URL",
    defaultBase: "https://api.groq.com",
  },
  openrouter: {
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    fallbackKeys: [],
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    privacyUrl: "https://openrouter.ai/privacy",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    defaultBase: "https://openrouter.ai",
  },
  nvidia: {
    label: "NVIDIA NIM",
    envKey: "NVIDIA_API_KEY",
    fallbackKeys: ["NVIDIA_NIM_API_KEY"],
    modelEnv: "NVIDIA_MODEL",
    defaultModel: "meta/llama-3.1-70b-instruct",
    privacyUrl: "https://www.nvidia.com/en-us/privacy-policy/",
    baseUrlEnv: "NVIDIA_BASE_URL",
    defaultBase: "https://integrate.api.nvidia.com",
  },
};

const ORDER: ProviderId[] = ["gemini", "groq", "openrouter", "nvidia"];

function apiKey(spec: ProviderSpec): string | null {
  for (const key of [spec.envKey, ...spec.fallbackKeys]) {
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

/** Origin override for self-hosted gateways (Ollama, LiteLLM, llama.cpp) and tests. */
function baseUrl(spec: ProviderSpec): string {
  const value = process.env[spec.baseUrlEnv];
  if (!value || !value.trim()) return spec.defaultBase;
  return value.trim().replace(/\/$/, "");
}

/** Is the AI layer switched on by the operator? Defaults to on. */
export function aiEnabled(): boolean {
  const settings = getSettings();
  return settings.ai_enabled !== "false";
}

/** The active provider + model, or null when keyless (deterministic mode). */
export function configuredProvider(): ProviderInfo | null {
  if (!aiEnabled()) return null;
  for (const id of ORDER) {
    const spec = PROVIDERS[id];
    if (apiKey(spec)) {
      return {
        id,
        label: spec.label,
        model: process.env[spec.modelEnv]?.trim() || spec.defaultModel,
        envKey: spec.envKey,
        privacyUrl: spec.privacyUrl,
      };
    }
  }
  return null;
}

/** Human-readable disclosure for the UI: who processes what. */
export function aiDisclosure(): {
  enabled: boolean;
  provider: string | null;
  model: string | null;
  scope: string;
} {
  const provider = configuredProvider();
  return {
    enabled: aiEnabled(),
    provider: provider?.label ?? null,
    model: provider?.model ?? null,
    scope:
      "Only aggregate practice facts (counts, amounts, due dates, names) are sent — never documents, passwords, PAN or GSTIN values.",
  };
}

// PAN: 5 letters, 4 digits, 1 letter. GSTIN: 15-character registration no.
const PAN_PATTERN = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const GSTIN_PATTERN = /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1,2}[A-Z0-9]{1,4}[A-Z0-9]\b/g;

/** Strips statutory identifiers from outbound AI prompts (defence in depth). */
export function redactIdentifiers(text: string): string {
  return text.replace(PAN_PATTERN, "[PAN-REDACTED]").replace(GSTIN_PATTERN, "[GSTIN-REDACTED]");
}

export type CompletionResult = { text: string; provider: ProviderId; model: string };

// ── Tool-calling chat (agent loop) ────────────────────────────────────────────

export type AgentToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AgentToolCall = { id: string; name: string; args: Record<string, unknown> };

export type AgentMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: AgentToolCall[] }
  | { role: "tool"; name: string; content: string; toolCallId?: string };

export type ChatWithToolsResult = {
  content: string;
  toolCalls: AgentToolCall[];
  provider: ProviderId;
  model: string;
};

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * One model turn with tools. Provider-agnostic normalisation:
 * OpenAI-compatible (Groq/OpenRouter/NVIDIA) `tool_calls`, and Gemini
 * `functionCall` parts. Returns null on any failure so callers can fall back.
 */
export async function chatWithTools(opts: {
  system: string;
  messages: AgentMessage[];
  tools: AgentToolSchema[];
  maxTokens?: number;
  temperature?: number;
}): Promise<ChatWithToolsResult | null> {
  const provider = configuredProvider();
  if (!provider) return null;

  const system = redactIdentifiers(opts.system) + SYSTEM_TAIL;
  const messages = opts.messages.map((m) => ({ ...m, content: redactIdentifiers(m.content) }));
  const timeout = AbortSignal.timeout(15_000);

  try {
    if (provider.id === "gemini") {
      const spec = PROVIDERS.gemini;
      const key = apiKey(spec)!;
      const contents = messages.map((m) => {
        if (m.role === "user") return { role: "user", parts: [{ text: m.content }] };
        if (m.role === "tool") {
          return { role: "user", parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }] };
        }
        const parts: Array<Record<string, unknown>> = [];
        if (m.content) parts.push({ text: m.content });
        for (const call of m.toolCalls ?? []) parts.push({ functionCall: { name: call.name, args: call.args } });
        return { role: "model", parts };
      });

      const url = `${baseUrl(spec)}/v1beta/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: timeout,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          tools: [
            {
              functionDeclarations: opts.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: sanitizeGeminiSchema(t.parameters),
              })),
            },
          ],
          generationConfig: {
            maxOutputTokens: opts.maxTokens ?? 700,
            temperature: opts.temperature ?? 0.3,
          },
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }>;
          };
        }>;
      };
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p.text ?? "").join("").trim();
      const toolCalls: AgentToolCall[] = parts
        .filter((p) => p.functionCall?.name)
        .map((p, i) => ({
          id: `g_${i}_${p.functionCall!.name}`,
          name: p.functionCall!.name!,
          args: (p.functionCall!.args ?? {}) as Record<string, unknown>,
        }));
      return { content: text, toolCalls, provider: provider.id, model: provider.model };
    }

    const spec = PROVIDERS[provider.id];
    const key = apiKey(spec)!;
    const url =
      provider.id === "groq"
        ? `${baseUrl(spec)}/openai/v1/chat/completions`
        : provider.id === "openrouter"
          ? `${baseUrl(spec)}/api/v1/chat/completions`
          : `${baseUrl(spec)}/v1/chat/completions`;

    const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    if (provider.id === "openrouter") {
      headers["HTTP-Referer"] = "http://localhost";
      headers["X-Title"] = "CADocs";
    }

    const openaiMessages = [
      { role: "system", content: system },
      ...messages.map((m) => {
        if (m.role === "tool") {
          return { role: "tool", tool_call_id: m.toolCallId ?? m.name, content: m.content };
        }
        if (m.role === "assistant") {
          return {
            role: "assistant",
            content: m.content || null,
            ...(m.toolCalls?.length
              ? {
                  tool_calls: m.toolCalls.map((c) => ({
                    id: c.id,
                    type: "function",
                    function: { name: c.name, arguments: JSON.stringify(c.args) },
                  })),
                }
              : {}),
          };
        }
        return { role: "user", content: m.content };
      }),
    ];

    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: timeout,
      body: JSON.stringify({
        model: provider.model,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 700,
        messages: openaiMessages,
        tools: opts.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        tool_choice: "auto",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
        };
      }>;
    };
    const message = data.choices?.[0]?.message;
    const toolCalls: AgentToolCall[] = (message?.tool_calls ?? [])
      .filter((c) => c.function?.name)
      .map((c, i) => ({
        id: c.id || `c_${i}_${c.function!.name}`,
        name: c.function!.name!,
        args: parseArgs(c.function!.arguments),
      }));
    return {
      content: (message?.content ?? "").trim(),
      toolCalls,
      provider: provider.id,
      model: provider.model,
    };
  } catch {
    return null;
  }
}

/** Gemini rejects some JSON-Schema keywords; keep the supported subset. */
function sanitizeGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const strip = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    delete obj.additionalProperties;
    if (obj.properties && typeof obj.properties === "object") {
      for (const value of Object.values(obj.properties as Record<string, unknown>)) strip(value);
    }
    if (obj.items) strip(obj.items);
  };
  strip(clone);
  return clone;
}

const SYSTEM_TAIL =
  "\n\nPrivacy rules: never invent numbers; treat all client data as confidential; do not echo statutory identifiers (PAN/GSTIN) back — refer to them by client name instead. Do not store or retain any of this content beyond this inference.";

/**
 * Calls the configured provider. Returns null (never throws) when AI is off,
 * no provider is configured, or the request fails — callers then use their
 * keyless fallback so the UX degrades gracefully.
 */
export async function complete(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<CompletionResult | null> {
  const provider = configuredProvider();
  if (!provider) return null;

  const system = redactIdentifiers(opts.system) + SYSTEM_TAIL;
  const user = redactIdentifiers(opts.user);
  const timeout = AbortSignal.timeout(15_000);

  try {
    if (provider.id === "gemini") {
      const spec = PROVIDERS.gemini;
      const key = apiKey(spec)!;
      const url = `${baseUrl(spec)}/v1beta/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: timeout,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            maxOutputTokens: opts.maxTokens ?? 600,
            temperature: opts.temperature ?? 0.4,
          },
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
      return text ? { text, provider: provider.id, model: provider.model } : null;
    }

    const spec = PROVIDERS[provider.id];
    const key = apiKey(spec)!;
    const url =
      provider.id === "groq"
        ? `${baseUrl(spec)}/openai/v1/chat/completions`
        : provider.id === "openrouter"
          ? `${baseUrl(spec)}/api/v1/chat/completions`
          : `${baseUrl(spec)}/v1/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    };
    if (provider.id === "openrouter") {
      headers["HTTP-Referer"] = "http://localhost";
      headers["X-Title"] = "CADocs";
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      signal: timeout,
      body: JSON.stringify({
        model: provider.model,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text ? { text, provider: provider.id, model: provider.model } : null;
  } catch {
    return null;
  }
}