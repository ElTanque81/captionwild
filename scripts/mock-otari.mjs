// A tiny stand-in for the Otari API, for offline testing and demos:
//   node scripts/mock-otari.mjs            → http://localhost:8787/api/v1
//   OTARI_BASE_URL=http://localhost:8787/api/v1 OTARI_API_KEY=tk-mock node scripts/dev-server.mjs
// It prices requests like Otari does (usage.cost_usd) and refuses with a
// budget error once MOCK_BUDGET_USD is spent, so the budget path can be shown.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_PORT || 8787);
const budget = Number(process.env.MOCK_BUDGET_USD || 0.05);
let spent = 0;
const models = [
  { id: "mistral:mistral-small-latest", name: "mistral:mistral-small-latest", in: 0.1, out: 0.3, speed: 600 },
  { id: "openai:gpt-4o-mini", name: "openai:gpt-4o-mini", in: 0.15, out: 0.6, speed: 900 },
  { id: "anthropic:claude-sonnet-4-6", name: "anthropic:claude-sonnet-4-6", in: 3, out: 15, speed: 1600 },
];

function caption(product, n, model) {
  const angles = [
    `Meet ${product}. Small details, big difference: made to be used every single day.`,
    `Why we made ${product}: because good things should last. Honest materials, ready to ship.`,
    `POV: you finally found ${product} that feels like it was made for you.`,
    `${product}, designed to be loved and used again.`,
    `The one you reach for first: ${product}.`,
  ];
  const tag = model.split(":")[1].split("-")[0];
  return { variants: angles.slice(0, n).map((t) => ({ text: t, hashtags: ["shopsmall", "handmade", tag] })) };
}

createServer(async (req, res) => {
  const send = (status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
  if (!/^Bearer tk-/.test(req.headers.authorization || "")) return send(401, { detail: "Invalid API key" });
  if (req.url === "/api/v1/models") {
    return send(200, { object: "list", data: models.map((m) => ({ id: m.id, name: m.name, object: "model", architecture: { input_modalities: ["text"], output_modalities: ["text"] }, pricing: { input_price_per_million: m.in, output_price_per_million: m.out }, pricing_source: "default" })) });
  }
  if (req.url === "/api/v1/chat/completions" && req.method === "POST") {
    let raw = ""; for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    const m = models.find((x) => x.id === body.model);
    if (!m) return send(404, { detail: { code: "model_not_found", message: `Model ${body.model} not found` } });
    if (spent >= budget) return send(429, { detail: { code: "budget_exceeded", message: `API key has exceeded budget limit ($${budget})` } }, { "retry-after": "3600" });
    const prompt = body.messages.map((x) => x.content).join("\n");
    const product = (prompt.match(/Product: (.*)/) || [])[1] || "this product";
    const n = Number((prompt.match(/Write (\d+) variants/) || [])[1] || 1);
    const content = JSON.stringify(caption(product, n, m.id));
    const pt = Math.round(prompt.length / 4), ct = Math.round(content.length / 4);
    const cost = Math.round(((pt * m.in + ct * m.out) / 1e6) * 1e6) / 1e6;
    spent += cost;
    await new Promise((r) => setTimeout(r, m.speed * (0.7 + Math.random() * 0.6)));
    return send(200, {
      id: "chatcmpl-mock", object: "chat.completion", model: m.id,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      usage: { prompt_tokens: pt, completion_tokens: ct, total_tokens: pt + ct, cost_usd: cost.toFixed(6), pricing_source: "default" },
    }, { "otari-request-id": `req_${Date.now()}` });
  }
  send(404, { detail: "Not found" });
}).listen(port, () => console.log(`Mock Otari on http://localhost:${port}/api/v1 (budget $${budget})`));
