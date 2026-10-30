// POST /api/llm — one chat completion through the Otari gateway.
// Body: { model, system, prompt, maxTokens?, temperature?, tags?: { platform, action, run } }
// Answer: { text, model, costUsd, pricingSource, tokens, ms, requestId }

import { allowedModels, describeError, json, otari, otariKey } from "../lib/otari.mjs";

const MAX_TOKENS = 1600;
const MAX_PROMPT = 12000;
const TAG_KEYS = ["platform", "action", "run", "language"];

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: { kind: "error", message: "Use POST" } });
  if (!otariKey()) return json(503, { error: { kind: "setup", message: "OTARI_API_KEY is not set on the server." } });

  let input;
  try { input = await req.json(); } catch { return json(400, { error: { kind: "error", message: "Body must be JSON" } }); }

  const model = String(input.model || "").trim();
  const system = String(input.system || "").slice(0, 4000);
  const prompt = String(input.prompt || "");
  if (!model) return json(400, { error: { kind: "error", message: "Pick a model first." } });
  if (!prompt || prompt.length > MAX_PROMPT) return json(400, { error: { kind: "error", message: "Prompt is empty or too long." } });

  const allow = allowedModels();
  if (allow.length && !allow.includes(model)) {
    return json(403, { error: { kind: "auth", message: `Model ${model} is not enabled for this app.` } });
  }

  // Tags go to Otari's usage rows, so spend can be grouped per platform/action
  // on the Otari dashboard. Only short, known keys; never user content.
  const metadata = { app: "captionwild" };
  for (const k of TAG_KEYS) {
    const v = input.tags?.[k];
    if (v != null && v !== "") metadata[k] = String(v).replace(/[^\w.\-: ]/g, "").slice(0, 64);
  }

  const body = {
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt },
    ],
    max_tokens: Math.max(64, Math.min(MAX_TOKENS, Number(input.maxTokens) || 1000)),
    temperature: Math.max(0, Math.min(1.5, Number(input.temperature ?? 0.8))),
    metadata,
  };

  const t0 = Date.now();
  let out;
  try {
    out = await otari("/chat/completions", { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    return json(502, { error: { kind: "network", message: `Could not reach Otari: ${e.message}` } });
  }
  const ms = Date.now() - t0;
  const { res, body: data } = out;
  const requestId = res.headers.get("otari-request-id") || null;

  if (!res.ok) {
    const retry = res.headers.get("retry-after");
    return json(res.status, { error: { ...describeError(res.status, data), requestId, retryAfter: retry } });
  }

  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  const text = Array.isArray(content) ? content.map((c) => c.text || "").join("") : String(content || "");
  const u = data.usage || {};

  return json(200, {
    text,
    model: data.model || model,
    finishReason: choice?.finish_reason || null,
    costUsd: u.cost_usd != null ? Number(u.cost_usd) : null,
    pricingSource: u.pricing_source || null,
    tokens: { input: u.prompt_tokens ?? null, output: u.completion_tokens ?? null, total: u.total_tokens ?? null },
    ms,
    requestId,
  });
};

export const config = { path: "/api/llm" };
