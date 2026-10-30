// Local dev server without the Netlify CLI: serves public/ and runs the
// functions in netlify/functions on /api/*. Usage:
//   OTARI_API_KEY=tk-... node scripts/dev-server.mjs   → http://localhost:8888
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pub = join(root, "public");
const routes = {
  "/api/llm": (await import(join(root, "netlify/functions/llm.mjs"))).default,
  "/api/models": (await import(join(root, "netlify/functions/models.mjs"))).default,
};
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const port = Number(process.env.PORT || 8888);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const fn = routes[url.pathname];
  if (fn) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await fn(request);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  const path = normalize(join(pub, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(pub)) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log(`CaptionWild on http://localhost:${port}`));
