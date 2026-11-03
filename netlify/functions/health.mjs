// GET /api/health — setup check. Never returns the key, only its shape,
// plus whether Otari accepts it.
import { OTARI_BASE, json, otari, otariKey } from "../lib/otari.mjs";
import { isChatCandidate, preferenceRank } from "../lib/prefer.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const key = otariKey();
  const otariVars = Object.keys(process.env).filter((k) => /otari/i.test(k));
  const report = {
    functionsRunning: true,
    keyFound: Boolean(key),
    keyShape: key ? `${key.slice(0, 10)}… (${key.length} chars)` : null,
    otariEnvVarNames: otariVars,
    baseUrl: OTARI_BASE,
  };
  if (key) {
    try {
      const { res, body } = await otari("/models", { method: "GET" });
      report.otariStatus = res.status;
      report.otariUrl = res.url;
      report.modelCount = Array.isArray(body.data) ? body.data.length : null;
      if (!res.ok) report.otariAnswer = JSON.stringify(body).slice(0, 300);
      const ids = (body.data || []).filter((m) => !m.type || m.type === "chat").map((m) => m.id);
      report.typedModels = (body.data || []).some((m) => m.type);
      if (url.searchParams.has("models")) report.models = ids;
      // ?probe=1 sends a 5-token request to the likeliest writing models and
      // reports which ones actually answer.
      if (url.searchParams.has("probe")) {
        const candidates = ids
          .filter(isChatCandidate)
          .sort((a, b) => preferenceRank(a) - preferenceRank(b))
          .slice(0, 8);
        report.probe = await Promise.all(candidates.map(async (model) => {
          const t0 = Date.now();
          try {
            const r = await otari("/chat/completions", { method: "POST", body: JSON.stringify({
              model, max_tokens: 5, messages: [{ role: "user", content: "Say OK." }], metadata: { app: "captionwild", action: "probe" } }) });
            const detail = r.body?.detail;
            return { model, ok: r.res.ok, status: r.res.status, ms: Date.now() - t0,
              cost: r.body?.usage?.cost_usd ?? null,
              error: r.res.ok ? undefined : String(typeof detail === "string" ? detail : detail?.message || JSON.stringify(r.body)).slice(0, 160) };
          } catch (e) {
            return { model, ok: false, error: e.message };
          }
        }));
      }
    } catch (e) {
      report.otariError = e.message;
    }
  }
  return json(200, report);
};

export const config = { path: "/api/health" };
