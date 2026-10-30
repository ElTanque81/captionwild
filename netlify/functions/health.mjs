// GET /api/health — setup check. Never returns the key, only its shape,
// plus whether Otari accepts it.
import { OTARI_BASE, json, otari, otariKey } from "../lib/otari.mjs";

export default async () => {
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
    } catch (e) {
      report.otariError = e.message;
    }
  }
  return json(200, report);
};

export const config = { path: "/api/health" };
