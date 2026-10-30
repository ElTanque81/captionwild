// Shared helpers for the Otari proxy functions.
// The Otari API key lives only here, in the Netlify environment, never in the browser.

export const OTARI_BASE = (process.env.OTARI_BASE_URL || "https://api.otari.ai/api/v1").replace(/\/+$/, "");

export function otariKey() {
  return process.env.OTARI_API_KEY || "";
}

// Optional allow-list: OTARI_MODELS="openai:gpt-4o-mini,anthropic:claude-haiku-4-5"
export function allowedModels() {
  return (process.env.OTARI_MODELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

export async function otari(path, init = {}) {
  const res = await fetch(`${OTARI_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${otariKey()}`,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { res, body };
}

// Turn an Otari error body into a short, stable code + message for the UI.
export function describeError(status, body) {
  const detail = body?.detail ?? body?.error ?? body;
  const code = (typeof detail === "object" && (detail.code || detail.type)) || body?.code || "";
  const message =
    (typeof detail === "string" && detail) ||
    detail?.message ||
    body?.message ||
    body?.raw ||
    `Otari answered ${status}`;
  let kind = "error";
  if (/budget/i.test(`${code} ${message}`)) kind = "budget";
  else if (status === 429) kind = "rate_limit";
  else if (status === 401 || status === 403) kind = "auth";
  else if (/pric/i.test(`${code} ${message}`)) kind = "pricing";
  return { kind, code: String(code || ""), message: String(message).slice(0, 400), status };
}
