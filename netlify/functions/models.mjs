// GET /api/models — the text models this Otari key can reach, with their prices.
// Answer: { models: [{ id, name, inPerM, outPerM, priced, context }] }

import { allowedModels, describeError, json, otari, otariKey } from "../lib/otari.mjs";
import { RECOMMENDED, isChatCandidate, preferenceRank } from "../lib/prefer.mjs";

export default async () => {
  if (!otariKey()) return json(503, { error: { kind: "setup", message: "OTARI_API_KEY is not set on the server." } });

  let out;
  try {
    out = await otari("/models", { method: "GET" });
  } catch (e) {
    return json(502, { error: { kind: "network", message: `Could not reach Otari: ${e.message}` } });
  }
  const { res, body } = out;
  if (!res.ok) return json(res.status, { error: describeError(res.status, body) });

  const allow = allowedModels();
  const models = (body.data || [])
    .filter((m) => {
      const outMods = m.architecture?.output_modalities;
      if (Array.isArray(outMods) && outMods.length && !outMods.includes("text")) return false;
      if (!isChatCandidate(m.id)) return false;
      return !allow.length || allow.includes(m.id);
    })
    .map((m) => {
      const p = m.pricing || {};
      const inPerM = p.input_price_per_million != null ? Number(p.input_price_per_million) : null;
      const outPerM = p.output_price_per_million != null ? Number(p.output_price_per_million) : null;
      return {
        id: m.id,
        name: m.name || m.id,
        inPerM,
        outPerM,
        priced: m.pricing_source !== "none" && (inPerM != null || outPerM != null),
        context: m.context_window ?? null,
        rank: preferenceRank(m.id),
        recommended: RECOMMENDED.includes(m.id),
      };
    })
    // Skip models no one has priced: with a budget on the key Otari refuses them.
    .filter((m) => m.priced)
    // Well-known writing models first (the first one is the default), then the rest cheapest first.
    .sort((a, b) => a.rank - b.rank || (a.outPerM ?? 1e9) - (b.outPerM ?? 1e9) || a.id.localeCompare(b.id));

  return json(200, { models }, { "cache-control": "private, max-age=60" });
};

export const config = { path: "/api/models" };
