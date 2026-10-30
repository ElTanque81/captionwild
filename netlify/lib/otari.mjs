// Shared helpers for the Otari proxy functions.
// The Otari API key lives only here, in the Netlify environment, never in the browser.

export const OTARI_BASE = ((globalThis.Netlify?.env?.get?.("OTARI_BASE_URL")) || process.env.OTARI_BASE_URL || "https://api.otari.ai/api/v1").trim().replace(/\/+$/, "");

// Read from Netlify's runtime env first, then process.env; trim stray quotes/spaces
// that easily sneak in when the key is pasted into the dashboard.
function env(name) {
  let v = "";
  try { v = globalThis.Netlify?.env?.get?.(name) || ""; } catch {}
  return (v || process.env[name] || "").trim().replace(/^["']|["']$/g, "").trim();
}

export function otariKey() {
  return env("OTARI_API_KEY") || env("OTARI_KEY") || env("OTARI_API_TOKEN");
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

// Otari is served from more than one region. A key minted in another region
// (e.g. an EU key "otk_v1_eu_…" sent to api.otari.ai) is answered 421 with
// "This API key belongs to <host>." We follow that once and remember the host.
let regionBase = null;

async function send(base, path, init) {
  const res = await fetch(`${base}${path}`, {
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

export async function otari(path, init = {}) {
  const base = regionBase || OTARI_BASE;
  let out = await send(base, path, init);
  if (out.res.status === 421) {
    const detail = typeof out.body?.detail === "string" ? out.body.detail : out.body?.raw || "";
    const host = (detail.match(/belongs to ([a-z0-9.-]+\.[a-z]{2,})/i) || [])[1];
    if (host) {
      regionBase = `https://${host}/api/v1`;
      out = await send(regionBase, path, init);
    }
  }
  return out;
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
