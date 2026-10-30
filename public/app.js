/**
 * CaptionWild — product copy and social captions, on any model, through Otari.
 *
 * Every AI call goes to our own Netlify Function (/api/llm), which forwards it
 * to the Otari gateway (Mozilla.ai) with the server-side Otari key. Otari picks
 * the provider, enforces the key's budget and returns the exact cost of each
 * request, which the app shows per platform, per run and per session.
 *
 *   GET  /api/models  → models this Otari key can reach, with prices
 *   POST /api/llm     → { text, model, costUsd, tokens, ms, requestId }
 *
 * Without a reachable backend (plain static preview) the app runs in demo mode
 * with canned copy, so the UI can still be explored.
 */

const API = { models: "/api/models", llm: "/api/llm" };

const PLATFORMS = [
  { id: "shop", name: "Shop listing", color: "var(--shop)", limit: 2000, hashtags: 0,
    guide: "A product description for an online shop (Etsy/Shopify). Open with the benefit, then 3–5 short scannable lines on materials, size, care and why it's special. No hashtags. 80–160 words." },
  { id: "instagram", name: "Instagram", color: "var(--instagram)", limit: 2200, hashtags: 8,
    guide: "An Instagram caption. Strong first line (it is cut off after ~125 characters), short paragraphs, end with the call to action. 40–90 words." },
  { id: "tiktok", name: "TikTok", color: "var(--tiktok)", limit: 4000, hashtags: 5,
    guide: "A TikTok caption. Punchy, conversational, hook in the first 8 words, may use 'POV:' or a question. 15–40 words." },
  { id: "pinterest", name: "Pinterest", color: "var(--pinterest)", limit: 500, hashtags: 4,
    guide: "A Pinterest pin description. Search-friendly: name the product and use cases with natural keywords. 30–60 words." },
  { id: "linkedin", name: "LinkedIn", color: "var(--linkedin)", limit: 3000, hashtags: 3,
    guide: "A LinkedIn post. Professional but human, a small story or insight behind the product, line breaks between thoughts. 60–120 words. Few or no emoji." },
  { id: "x", name: "X", color: "var(--x)", limit: 280, hashtags: 2,
    guide: "A post for X. One or two sentences. The whole text INCLUDING hashtags must stay under 270 characters." },
];

const LANGUAGES = ["English", "Deutsch", "Español", "Français", "Italiano", "Português", "Nederlands", "Polski", "Türkçe", "日本語", "한국어", "中文"];

const KEYS = { brands: "captionwild:brands", activeBrand: "captionwild:active-brand", history: "captionwild:history", last: "captionwild:last-brief", theme: "captionwild:theme", engine: "captionwild:engine:v2", spend: "captionwild:spend" };

/* Theme: "auto" follows the system, "light"/"dark" are fixed. */
const THEMES = {
  auto:  { label: "Auto",  next: "light", icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor"/></svg>' },
  light: { label: "Light", next: "dark",  icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
  dark:  { label: "Dark",  next: "auto",  icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor"/></svg>' },
};

function applyTheme(name) {
  const t = THEMES[name] ? name : "auto";
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  const btn = document.getElementById("theme");
  if (btn) {
    btn.innerHTML = `${THEMES[t].icon}<span>${THEMES[t].label}</span>`;
    btn.dataset.theme = t;
    btn.setAttribute("aria-label", `Theme: ${THEMES[t].label}. Click to change.`);
  }
  try { localStorage.setItem(KEYS.theme, t); } catch {}
  return t;
}

// Apply the last choice before anything else renders, to avoid a flash.
try { applyTheme(localStorage.getItem(KEYS.theme) || "auto"); } catch { applyTheme("auto"); }

const DEFAULT_BRAND = { id: "default", name: "My brand", voice: "Friendly, clear and honest", audience: "", avoid: "", emoji: "few" };

const $ = (s) => document.querySelector(s);

const state = {
  online: false,      // true when /api/models answered, i.e. Otari is reachable
  models: [],         // [{ id, name, inPerM, outPerM, priced }]
  engine: { write: "", rewrite: "", duel: "", cap: 0.25 },
  spend: { usd: 0, requests: 0, tokens: 0, unpriced: 0, since: Date.now() },
  brands: [],
  activeBrandId: "default",
  history: [],
  results: null, // { brief, byPlatform: { [id]: [{ text, hashtags }] } }
  tab: null,
  busy: false,
};

/* ------------------------------------------------------------------ host */

async function connect() {
  try {
    const res = await fetch(API.models, { headers: { accept: "application/json" } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error?.message || `HTTP ${res.status}`), data?.error || {});
    state.models = data.models || [];
    state.online = state.models.length > 0;
    if (!state.online) throw new Error("This Otari key cannot reach any text model yet.");
    $("#conn").classList.add("on");
    $("#conn").title = `Connected to Otari · ${state.models.length} models`;
  } catch (e) {
    state.online = false;
    $("#conn").title = `Demo mode: ${e?.message || e}`;
    state.offlineReason = e?.kind === "setup" ? "The server has no Otari key yet (OTARI_API_KEY)." : (e?.message || "Otari is not reachable.");
    console.info("[captionwild] demo mode:", e?.message || e);
  }
}

async function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[captionwild] save failed", key, e);
  }
}

/* ------------------------------------------------------------- prompting */

function brandBlock(b) {
  const emoji = { none: "Do not use emoji.", few: "Use at most 1–2 fitting emoji.", many: "Emoji are welcome where they add energy." }[b.emoji] || "";
  return [
    `Brand: ${b.name}`,
    b.voice && `Voice: ${b.voice}`,
    b.audience && `Audience: ${b.audience}`,
    b.avoid && `Never use these words or phrases: ${b.avoid}`,
    emoji,
  ].filter(Boolean).join("\n");
}

const SYSTEM = `You are a senior e-commerce and social media copywriter.
You write copy that sounds human, specific and true to the product. You never invent facts (prices, materials, awards, discounts) that the user did not give you.
Respond with JSON only, no markdown fences, in exactly this shape:
{"variants":[{"text":"...","hashtags":["word","word"]}]}
Hashtags are lowercase, without the # sign, no spaces. Each variant must take a clearly different angle (e.g. benefit, story, feeling, practical detail).`;

function buildPrompt(brief, platform, brand) {
  return `${brandBlock(brand)}

Platform: ${platform.name}
Format: ${platform.guide}
Hard limit: ${platform.limit} characters per text.
Hashtags per variant: ${platform.hashtags === 0 ? "none (empty array)" : `${Math.max(2, platform.hashtags - 3)}–${platform.hashtags}`}
Language: write everything in ${brief.language}.

Product: ${brief.product}
Details: ${brief.details || "(none given — stay general and do not invent specifics)"}
Call to action: ${brief.cta || "(choose a natural one for the platform, without inventing offers)"}

Write ${brief.count} variants.`;
}

function parseVariants(raw) {
  const text = typeof raw === "string" ? raw : "";
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("The model did not return any copy. Try again.");
  const data = JSON.parse(text.slice(start, end + 1));
  const list = Array.isArray(data.variants) ? data.variants : [];
  const clean = list
    .map((v) => ({
      text: String(v.text || "").trim(),
      hashtags: (Array.isArray(v.hashtags) ? v.hashtags : [])
        .map((h) => String(h).replace(/^#+/, "").replace(/\s+/g, "").trim())
        .filter(Boolean),
    }))
    .filter((v) => v.text);
  if (!clean.length) throw new Error("The model returned an empty answer. Try again.");
  return clean;
}

/* One request through Otari. Returns the full answer (text + cost + timing)
   and books the cost on the session meter. */
async function callLLM(userPrompt, { model, maxTokens = 1400, tags = {} } = {}) {
  if (!state.online) {
    const text = await demoAnswer(userPrompt);
    return { text, model: "demo", costUsd: 0, tokens: { total: 0 }, ms: 700, demo: true };
  }
  if (state.engine.cap > 0 && state.spend.usd >= state.engine.cap) {
    throw Object.assign(new Error(`spending cap of ${usd(state.engine.cap)} reached`), { kind: "cap" });
  }
  const res = await fetch(API.llm, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: model || state.engine.write, system: SYSTEM, prompt: userPrompt, maxTokens, temperature: 0.8, tags }),
  });
  const data = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `HTTP ${res.status}`), data?.error || {});
  book(data);
  return data;
}

async function ask(userPrompt, maxTokens = 1400, opts = {}) {
  return (await callLLM(userPrompt, { maxTokens, ...opts })).text;
}

/* ----------------------------------------------------------------- spend */

function usd(n) {
  if (n == null || Number.isNaN(n)) return "–";
  if (n === 0) return "$0";
  if (n < 0.01) return "$" + n.toFixed(5).replace(/0+$/, "");
  return "$" + n.toFixed(n < 1 ? 3 : 2);
}

function book(r) {
  state.spend.requests += 1;
  state.spend.tokens += r.tokens?.total || 0;
  if (r.costUsd == null) state.spend.unpriced += 1;
  else state.spend.usd = Math.round((state.spend.usd + r.costUsd) * 1e6) / 1e6;
  save(KEYS.spend, state.spend);
  renderMeter();
}

function renderMeter() {
  const s = state.spend;
  const cap = state.engine.cap;
  const pct = cap > 0 ? Math.min(100, (s.usd / cap) * 100) : 0;
  const bar = $("#meter-bar");
  bar.style.width = `${pct}%`;
  bar.classList.toggle("warn", pct >= 75 && pct < 100);
  bar.classList.toggle("full", pct >= 100);
  $("#meter-text").textContent = state.online
    ? `${usd(s.usd)}${cap > 0 ? ` of ${usd(cap)}` : ""} · ${s.requests} request${s.requests === 1 ? "" : "s"}${s.unpriced ? ` · ${s.unpriced} unpriced` : ""}`
    : `Demo mode: ${state.offlineReason || "no real requests, no cost"}`;
}

function modelLabel(id) {
  const m = state.models.find((x) => x.id === id);
  const raw = m ? (m.name && m.name !== m.id && !/[:/]/.test(m.name) ? m.name : m.id) : String(id || "");
  return raw.replace(/^[^:]+:/, "").replace(/^[^/]+\//, "");
}

/* Rough price of one caption run (≈900 input + 600 output tokens), for the picker. */
function priceHint(m) {
  if (!m.priced) return "unpriced";
  const est = ((m.inPerM || 0) * 900 + (m.outPerM || 0) * 600) / 1e6;
  return `≈${usd(est)}/platform`;
}

function renderEngine() {
  const fill = (sel, value) => {
    sel.innerHTML = "";
    if (!state.online) {
      sel.append(new Option("Demo (no Otari key)", ""));
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    const rec = state.models.filter((m) => m.recommended);
    const rest = state.models.filter((m) => !m.recommended);
    const group = (label, list) => {
      if (!list.length) return;
      const g = document.createElement("optgroup");
      g.label = label;
      for (const m of list) g.append(new Option(`${modelLabel(m.id)} · ${priceHint(m)}`, m.id));
      sel.append(g);
    };
    if (rec.length) { group("Recommended (tested)", rec); group("All models", rest); }
    else for (const m of state.models) sel.append(new Option(`${modelLabel(m.id)} · ${priceHint(m)}`, m.id));
    sel.value = state.models.some((m) => m.id === value) ? value : state.models[0].id;
  };
  fill($("#model-write"), state.engine.write);
  fill($("#model-rewrite"), state.engine.rewrite || state.engine.write);
  fill($("#duel-b"), state.engine.duel || (state.models[1] || state.models[0] || {}).id);
  state.engine.write = $("#model-write").value;
  state.engine.rewrite = $("#model-rewrite").value;
  state.engine.duel = $("#duel-b").value;
  $("#cap").value = state.engine.cap || "";
  renderMeter();
}

function readEngine() {
  state.engine.write = $("#model-write").value;
  state.engine.rewrite = $("#model-rewrite").value;
  state.engine.duel = $("#duel-b").value;
  const cap = parseFloat($("#cap").value);
  state.engine.cap = Number.isFinite(cap) && cap > 0 ? cap : 0;
  save(KEYS.engine, state.engine);
  renderMeter();
}

/* Canned output so the UI can be previewed in a normal browser. */
function demoAnswer(prompt) {
  const product = (prompt.match(/Product: (.*)/) || [])[1] || "your product";
  const one = /Write 1 variants/.test(prompt) || /Rewrite/.test(prompt);
  const base = [
    { text: `Meet ${product}. Made with care, built for every day — the kind of thing you reach for first.\n\nTap the link to see it up close.`, hashtags: ["handmade", "shopsmall", "madewithlove", "giftideas"] },
    { text: `Small details, big difference. ${product} is the upgrade your routine has been waiting for. ✨`, hashtags: ["everydayessentials", "smallbusiness", "newin"] },
    { text: `POV: you finally found ${product} that feels like it was made for you. Comment "LINK" and we'll send it over.`, hashtags: ["tiktokmademebuyit", "shoplocal"] },
    { text: `Why we made ${product}: because good things should last. Simple materials, honest work, ready to ship.`, hashtags: ["slowliving", "qualityoverquantity"] },
    { text: `${product} — designed to be used, loved and used again.`, hashtags: ["design", "makers"] },
  ];
  return new Promise((r) => setTimeout(() => r(JSON.stringify({ variants: one ? [base[1]] : base })), 700));
}

/* ---------------------------------------------------------------- brands */

function activeBrand() {
  return state.brands.find((b) => b.id === state.activeBrandId) || state.brands[0] || DEFAULT_BRAND;
}

function renderBrands() {
  const sel = $("#brand");
  sel.innerHTML = "";
  for (const b of state.brands) sel.add(new Option(b.name, b.id, false, b.id === state.activeBrandId));
  sel.add(new Option("+ New brand voice…", "__new"));
}

function openBrandDialog(brand) {
  const isNew = !brand;
  const b = brand || { ...DEFAULT_BRAND, id: "", name: "" };
  $("#b-name").value = b.name;
  $("#b-voice").value = b.voice;
  $("#b-audience").value = b.audience;
  $("#b-avoid").value = b.avoid;
  $("#b-emoji").value = b.emoji;
  $("#brand-dialog").dataset.editing = isNew ? "" : b.id;
  $("#b-delete").hidden = isNew || state.brands.length < 2;
  $("#b-new").hidden = isNew;
  $("#brand-dialog").showModal();
  $("#b-name").focus();
}

function readBrandForm(id) {
  return {
    id,
    name: $("#b-name").value.trim() || "My brand",
    voice: $("#b-voice").value.trim(),
    audience: $("#b-audience").value.trim(),
    avoid: $("#b-avoid").value.trim(),
    emoji: $("#b-emoji").value,
  };
}

async function commitBrand(asNew) {
  const editing = $("#brand-dialog").dataset.editing;
  if (!asNew && editing) {
    const b = readBrandForm(editing);
    state.brands = state.brands.map((x) => (x.id === editing ? b : x));
    state.activeBrandId = editing;
  } else {
    const b = readBrandForm("b" + Date.now().toString(36));
    state.brands.push(b);
    state.activeBrandId = b.id;
  }
  await save(KEYS.brands, state.brands);
  await save(KEYS.activeBrand, state.activeBrandId);
  renderBrands();
  $("#brand-dialog").close();
  toast("Brand voice saved");
}

/* ------------------------------------------------------------------ form */

function renderForm() {
  const box = $("#platforms");
  for (const p of PLATFORMS) {
    const l = document.createElement("label");
    l.className = "chip";
    l.style.setProperty("--c", p.color);
    l.innerHTML = `<input type="checkbox" value="${p.id}"><span class="dot"></span>${p.name}`;
    box.append(l);
  }
  const lang = $("#language");
  for (const l of LANGUAGES) lang.add(new Option(l, l));
  const guess = { de: "Deutsch", es: "Español", fr: "Français", it: "Italiano", pt: "Português", nl: "Nederlands", pl: "Polski", tr: "Türkçe", ja: "日本語", ko: "한국어", zh: "中文" }[(navigator.language || "en").slice(0, 2)];
  lang.value = guess || "English";
}

function readBrief() {
  return {
    product: $("#product").value.trim(),
    details: $("#details").value.trim(),
    cta: $("#cta").value.trim(),
    language: $("#language").value,
    count: Number($("#count").value),
    platforms: [...document.querySelectorAll("#platforms input:checked")].map((i) => i.value),
  };
}

function applyBrief(b) {
  if (!b) return;
  $("#product").value = b.product || "";
  $("#details").value = b.details || "";
  $("#cta").value = b.cta || "";
  if (b.language) $("#language").value = b.language;
  if (b.count) $("#count").value = String(b.count);
  for (const i of document.querySelectorAll("#platforms input")) i.checked = (b.platforms || []).includes(i.value);
}

function setStatus(msg, isError = false) {
  const s = $("#status");
  s.textContent = msg;
  s.classList.toggle("error", isError);
}

/* -------------------------------------------------------------- generate */

async function generate(e) {
  e.preventDefault();
  if (state.busy) return;
  const brief = readBrief();
  if (!brief.product) return setStatus("Name the product first.", true);
  if (!brief.platforms.length) return setStatus("Pick at least one place to post.", true);

  state.busy = true;
  $("#go").disabled = true;
  const brand = activeBrand();
  const byPlatform = {};
  const meta = {};
  const errors = [];
  const model = state.engine.write;
  const run = Date.now().toString(36);
  let done = 0;
  setStatus(`Writing for ${brief.platforms.length} platform${brief.platforms.length > 1 ? "s" : ""}…`);

  // Two requests at a time keeps it quick without hammering the host quota.
  const queue = [...brief.platforms];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      const p = PLATFORMS.find((x) => x.id === id);
      try {
        const r = await callLLM(buildPrompt(brief, p, brand), { model, tags: { platform: id, action: "write", run, language: brief.language } });
        byPlatform[id] = parseVariants(r.text);
        meta[id] = { model: r.model, costUsd: r.costUsd, ms: r.ms, tokens: r.tokens?.total ?? null };
      } catch (err) {
        errors.push(`${p.name}: ${friendlyError(err)}`);
      }
      done++;
      setStatus(`Writing… ${done} of ${brief.platforms.length} done`);
    }
  }
  await Promise.all([worker(), worker()]);

  state.busy = false;
  $("#go").disabled = false;

  const ids = brief.platforms.filter((id) => byPlatform[id]);
  if (!ids.length) {
    setStatus(errors[0] || "Nothing came back. Try again.", true);
    return;
  }
  state.results = { brief, brand: brand.name, byPlatform, meta, model, at: Date.now() };
  state.tab = ids[0];
  renderResults();
  const runCost = ids.reduce((sum, id) => sum + (meta[id]?.costUsd || 0), 0);
  const costNote = state.online ? ` ${ids.length} platform${ids.length > 1 ? "s" : ""} for ${usd(runCost)} on ${modelLabel(model)}.` : "";
  setStatus(errors.length ? `Done, but ${errors.join(" · ")}` : `Done.${costNote} Copy what you like or rewrite a variant.`, errors.length > 0);

  state.history.unshift(state.results);
  state.history = state.history.slice(0, 12);
  renderHistory();
  save(KEYS.history, state.history);
  save(KEYS.last, brief);
}

function friendlyError(err) {
  const kind = err?.kind || "";
  if (kind === "cap") return `your ${err.message}. Raise the cap or reset the meter`;
  if (kind === "budget") return "the Otari budget for this key is used up (enforced by Otari)";
  if (kind === "rate_limit") return `Otari rate limit, try again${err.retryAfter ? ` in ${err.retryAfter}s` : " in a minute"}`;
  if (kind === "auth") return `Otari refused the request: ${err.message}`;
  if (kind === "pricing") return "this model has no price in Otari yet, so budgeted traffic is refused. Pick another model";
  if (kind === "setup") return "the server has no Otari key yet";
  if (/No model could serve|not found|provider_not_configured|No provider accepted/i.test(err?.message || "")) {
    return `${modelLabel(state.engine.write)} isn't available on this Otari account right now. Pick another writing model`;
  }
  if (err instanceof SyntaxError) return "the answer was cut off, try fewer variants";
  return err?.message || "something went wrong";
}

/* --------------------------------------------------------------- results */

function renderResults() {
  const r = state.results;
  const tabs = $("#tabs");
  const box = $("#results");
  tabs.innerHTML = "";
  box.innerHTML = "";
  if (!r) return;

  const ids = r.brief.platforms.filter((id) => r.byPlatform[id]);
  tabs.setAttribute("role", "tablist");
  for (const id of ids) {
    const p = PLATFORMS.find((x) => x.id === id);
    const t = document.createElement("button");
    t.className = "tab";
    t.type = "button";
    t.setAttribute("role", "tab");
    t.setAttribute("aria-selected", String(id === state.tab));
    t.style.setProperty("--c", p.color);
    const c = r.meta?.[id]?.costUsd;
    t.textContent = `${p.name} (${r.byPlatform[id].length})${c != null && r.meta[id].model !== "demo" ? ` · ${usd(c)}` : ""}`;
    t.onclick = () => { state.tab = id; renderResults(); };
    tabs.append(t);
  }

  if (ids.length > 1) {
    const all = button("Copy all platforms", "mini copy-all", () => {
      copy(allText(r, ids), `Copied ${ids.length} platforms`);
    });
    tabs.append(all);
  }

  const p = PLATFORMS.find((x) => x.id === state.tab);
  const m = r.meta?.[state.tab];
  if (m && m.model !== "demo") {
    const info = document.createElement("p");
    info.className = "runinfo";
    info.innerHTML = `<span class="pill">${escapeHtml(modelLabel(m.model))}</span> <span>${usd(m.costUsd)}</span> <span>${(m.ms / 1000).toFixed(1)} s</span>${m.tokens ? ` <span>${m.tokens} tokens</span>` : ""} <span class="via">via Otari</span>`;
    box.append(info);
  }
  r.byPlatform[state.tab].forEach((v, i) => box.append(renderTag(p, v, i)));
}

function fullText(v) {
  return v.hashtags.length ? `${v.text}\n\n${v.hashtags.map((h) => "#" + h).join(" ")}` : v.text;
}

function allText(r, ids) {
  return ids.map((id) => {
    const p = PLATFORMS.find((x) => x.id === id);
    const variants = r.byPlatform[id].map((v, i) => `Variant ${i + 1}\n${fullText(v)}`).join("\n\n");
    return `===== ${p.name} =====\n\n${variants}`;
  }).join("\n\n\n");
}

/* Sharing. X and LinkedIn open a pre-filled post; Instagram, TikTok and
   Pinterest have no way to pre-fill text from a link, so the text is copied
   and the site opens for the user to paste it next to their photo or video. */
const enc = encodeURIComponent;
const SHARE = {
  x:         { label: "Post on X",        prefill: true,  url: (t) => `https://x.com/intent/tweet?text=${enc(t)}` },
  linkedin:  { label: "Post on LinkedIn", prefill: true,  url: (t) => `https://www.linkedin.com/feed/?shareActive=true&text=${enc(t)}` },
  instagram: { label: "Open Instagram",   prefill: false, url: () => "https://www.instagram.com/" },
  tiktok:    { label: "Open TikTok",      prefill: false, url: () => "https://www.tiktok.com/upload" },
  pinterest: { label: "Open Pinterest",   prefill: false, url: () => "https://www.pinterest.com/pin-builder/" },
};

function share(p, v) {
  const s = SHARE[p.id];
  const text = fullText(v);
  // Open first, inside the click, so the browser treats it as user-initiated.
  window.open(s.url(text), "_blank", "noopener,noreferrer");
  copy(text, s.prefill
    ? `${p.name} opened with your post. Text is also copied.`
    : `Copied. Paste it into your ${p.name} post.`);
}

function renderTag(p, v, index) {
  const el = document.createElement("article");
  el.className = "tag";
  el.style.setProperty("--c", p.color);
  el.style.animationDelay = `${index * 70}ms`;

  const text = document.createElement("p");
  text.className = "tag-text";
  text.textContent = v.text;

  const tags = document.createElement("div");
  tags.className = "tags-line";
  for (const h of v.hashtags) {
    const s = document.createElement("span");
    s.textContent = "#" + h;
    tags.append(s);
  }

  const len = [...fullText(v)].length;
  const pct = Math.min(100, (len / p.limit) * 100);
  const meter = document.createElement("div");
  meter.className = "meter" + (len > p.limit ? " over" : "");
  meter.innerHTML = `<div class="meter-bar"><div class="meter-fill" style="width:${pct}%"></div></div>
    <div class="meter-label">${len} / ${p.limit} characters${len > p.limit ? " — too long for " + p.name : ""}</div>`;

  const actions = document.createElement("div");
  actions.className = "tag-actions";
  const shorten = button("Shorter", "mini shorten", () => rewrite(el, p, index, "shorter"));
  const lengthen = button("Longer", "mini lengthen", () => rewrite(el, p, index, "longer"));

  if (SHARE[p.id]) {
    const sh = button(SHARE[p.id].label, "mini share", () => share(p, v));
    sh.title = SHARE[p.id].prefill ? `Opens ${p.name} with this text filled in` : `Copies the text and opens ${p.name}`;
    actions.append(sh);
  }
  actions.append(
    button("Copy", "mini copy", () => copy(fullText(v))),
    shorten,
    lengthen,
    button("Warmer", "mini", () => rewrite(el, p, index, "warmer")),
    button("Stronger CTA", "mini", () => rewrite(el, p, index, "cta")),
  );
  applyLengthLimits(actions, p, v);

  el.append(text);
  if (v.hashtags.length) el.append(tags);
  el.append(meter, actions);
  return el;
}

// Switch off Shorter/Longer when a text can't move further in that direction.
function applyLengthLimits(scope, p, v) {
  const s = scope.querySelector(".mini.shorten");
  const l = scope.querySelector(".mini.lengthen");
  if (s) {
    s.disabled = !canShorten(v);
    s.title = s.disabled ? "Already as short as it gets" : "";
  }
  if (l) {
    l.disabled = !canLengthen(p, v);
    l.title = l.disabled ? `Already as long as works well on ${p.name}` : "";
  }
}

function button(label, cls, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.onclick = fn;
  return b;
}

/* ------------------------------------------------------------- rewrites */

const charLen = (s) => [...String(s)].length;

// Chinese, Japanese and Korean pack far more meaning into one character.
const isDense = (s) => (String(s).match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length > charLen(s) * 0.3;

// Below this a text has no room left to shorten without losing its point.
const minLength = (s) => (isDense(s) ? 20 : 50);

const canShorten = (v) => charLen(v.text) > minLength(v.text);

// Longest text (hashtags excluded) that still reads well on each platform,
// and never past the platform's hard limit once the hashtags are added.
const COMFORT_MAX = { shop: 1500, instagram: 1200, tiktok: 600, pinterest: 500, linkedin: 1500, x: 280 };

function maxLength(p, v) {
  const hashtagChars = charLen(fullText(v)) - charLen(v.text);
  return Math.min(COMFORT_MAX[p.id] || p.limit, p.limit - hashtagChars);
}

// Enough room left to add at least a short sentence.
const canLengthen = (p, v) => maxLength(p, v) - charLen(v.text) >= (isDense(v.text) ? 10 : 30);

// The platform guide without its word ranges ("40–90 words"). Sending the
// range made the model grow an already-short text back to the minimum.
const styleOnly = (guide) => guide.replace(/\s*\d+\s*[–-]\s*\d+\s*words\.?/gi, "").trim();

const REWRITES = {
  shorter: "Make it shorter. Cut whole phrases rather than rewording. Keep the strongest idea and the call to action.",
  longer: "Make it longer and richer. Add concrete detail from the product information above, a sensory moment or a use case. Keep the same voice, the same opening idea and the call to action. Never invent facts (prices, materials, sizes, awards, discounts) that are not in the product information.",
  warmer: "Make it warmer and more personal, as if the maker is talking. Keep about the same length.",
  cta: "Keep the idea but end with a clearer, more compelling call to action. Keep about the same length.",
};

function rewritePrompt(brand, p, brief, v, kind, maxChars) {
  const cur = charLen(v.text);
  const length = kind === "longer"
    ? `The new text must be longer than the current ${cur} characters, ideally around ${maxChars} characters, and at most ${maxChars} characters long, hashtags not included. The current text is ${cur} characters.`
    : `The new text must be at most ${maxChars} characters long, hashtags not included. The current text is ${cur} characters.`;
  return `${brandBlock(brand)}

Product: ${brief.product}
Product information: ${brief.details || "(none given beyond the current text)"}

Platform: ${p.name}
Style: ${styleOnly(p.guide)}
Language: ${brief.language}

Rewrite this ${p.name} text. ${REWRITES[kind]}
${length}
Use at most ${v.hashtags.length} hashtags.
Return exactly 1 variant.

Text:
${v.text}

Hashtags: ${v.hashtags.join(", ") || "(none)"}`;
}

async function rewrite(el, p, index, kind) {
  if (el.classList.contains("busy")) return;
  const r = state.results;
  const v = r.byPlatform[p.id][index];
  const brand = state.brands.find((b) => b.name === r.brand) || activeBrand();
  const cur = charLen(v.text);

  if (kind === "shorter" && !canShorten(v)) {
    toast("This one is already as short as it gets.");
    return;
  }
  if (kind === "longer" && !canLengthen(p, v)) {
    toast(`This one is already as long as works well on ${p.name}.`);
    return;
  }

  el.classList.add("busy");
  el.querySelectorAll("button").forEach((b) => (b.disabled = true));
  const rwOpts = { model: state.engine.rewrite || state.engine.write, tags: { platform: p.id, action: `rewrite-${kind}` } };
  try {
    let next;
    if (kind === "shorter") {
      // Aim for about two thirds of the current length, then check the
      // result: one stricter retry, and never accept a text that got longer.
      const target = Math.max(minLength(v.text), Math.round(cur * 0.65));
      for (const maxChars of [target, Math.max(minLength(v.text), Math.round(cur * 0.5))]) {
        const [cand] = parseVariants(await ask(rewritePrompt(brand, p, r.brief, v, kind, maxChars), 700, rwOpts));
        if (charLen(cand.text) < cur) { next = cand; break; }
      }
      if (!next) throw new Error("couldn't make it any shorter without losing the message");
    } else if (kind === "longer") {
      // Mirror of Shorter: aim for about 1.4× the current length within the
      // platform's comfortable maximum, then check the result. One stricter
      // retry; never accept a text that got shorter or runs past the limit.
      const max = maxLength(p, v);
      const target = Math.min(max, Math.round(cur * 1.4) + 10);
      for (const maxChars of [target, Math.min(max, Math.round(cur * 1.25) + 10)]) {
        const [cand] = parseVariants(await ask(rewritePrompt(brand, p, r.brief, v, kind, maxChars), 900, rwOpts));
        const len = charLen(cand.text);
        if (len > cur && len <= max) { next = cand; break; }
      }
      if (!next) throw new Error("couldn't add more without padding or going past the limit");
    } else {
      const maxChars = Math.min(maxLength(p, v), Math.round(cur * 1.15) + 20);
      [next] = parseVariants(await ask(rewritePrompt(brand, p, r.brief, v, kind, maxChars), 700, rwOpts));
    }

    const hashtags = p.hashtags === 0 ? [] : (next.hashtags.length ? next.hashtags : v.hashtags).slice(0, Math.max(v.hashtags.length, 1));
    r.byPlatform[p.id][index] = { text: next.text, hashtags };
    save(KEYS.history, state.history);
    const fresh = renderTag(p, r.byPlatform[p.id][index], index);
    fresh.style.animationDelay = "0ms";
    el.replaceWith(fresh);
  } catch (err) {
    el.classList.remove("busy");
    el.querySelectorAll("button").forEach((b) => (b.disabled = false));
    applyLengthLimits(el, p, v);
    const label = { shorter: "Shorter", longer: "Longer" }[kind] || "Rewrite";
    toast(`${label} failed: ${friendlyError(err)}`);
  }
}

async function copy(text, message = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast(message);
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}

/* --------------------------------------------------------------- history */

function renderHistory() {
  const ul = $("#history");
  ul.innerHTML = "";
  state.history.forEach((h) => {
    const li = document.createElement("li");
    const names = h.brief.platforms.filter((id) => h.byPlatform[id]).map((id) => PLATFORMS.find((p) => p.id === id).name).join(", ");
    const b = button("", "", () => {
      state.results = h;
      state.tab = h.brief.platforms.find((id) => h.byPlatform[id]);
      applyBrief(h.brief);
      renderResults();
      $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    b.innerHTML = "";
    b.append(document.createTextNode(h.brief.product), document.createElement("br"));
    const small = document.createElement("small");
    small.textContent = names;
    b.append(small);
    li.append(b);
    ul.append(li);
  });
}

function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* ------------------------------------------------------------------ duel */

/* Same brief, same platform, two models side by side: one variant each, with
   the cost and time Otari reports. A cheap way to pick the right model. */
async function duel() {
  const brief = { ...readBrief(), count: 1 };
  if (!brief.product) return setStatus("Name the product first, then run the duel.", true);
  const pid = brief.platforms[0] || "instagram";
  const p = PLATFORMS.find((x) => x.id === pid);
  const brand = activeBrand();
  const a = state.engine.write;
  const b = state.engine.duel;
  const box = $("#duel-out");
  const go = $("#duel-go");
  if (state.online && a === b) return toast("Pick two different models for the duel.");

  go.disabled = true;
  box.innerHTML = `<p class="hint">Writing one ${escapeHtml(p.name)} caption on each model…</p>`;
  const prompt = buildPrompt(brief, p, brand);
  const run = Date.now().toString(36);
  const results = await Promise.allSettled([a, b].map((model) =>
    callLLM(prompt, { model, maxTokens: 900, tags: { platform: pid, action: "duel", run } })));
  go.disabled = false;

  box.innerHTML = "";
  const ok = [];
  results.forEach((res, i) => {
    const model = [a, b][i];
    const card = document.createElement("article");
    card.className = "duel-card";
    if (res.status === "rejected") {
      card.innerHTML = `<header><span class="pill">${escapeHtml(modelLabel(model) || "demo")}</span></header><p class="error">${escapeHtml(friendlyError(res.reason))}</p>`;
      box.append(card);
      return;
    }
    const r = res.value;
    let v;
    try { [v] = parseVariants(r.text); } catch (e) { v = { text: friendlyError(e), hashtags: [] }; }
    ok.push({ model, r });
    card.innerHTML = `<header><span class="pill">${escapeHtml(r.demo ? `Demo ${i ? "B" : "A"}` : modelLabel(r.model))}</span>
      <span class="stats">${usd(r.costUsd)} · ${(r.ms / 1000).toFixed(1)} s${r.tokens?.total ? ` · ${r.tokens.total} tok` : ""}</span></header>
      <p class="duel-text"></p>`;
    card.querySelector(".duel-text").textContent = fullText(v);
    const actions = document.createElement("div");
    actions.className = "duel-actions";
    actions.append(button("Copy", "mini", () => copy(fullText(v))));
    if (!r.demo && model !== state.engine.write) {
      actions.append(button("Use for writing", "mini", () => {
        $("#model-write").value = model;
        readEngine();
        toast(`Now writing with ${modelLabel(model)}`);
      }));
    }
    card.append(actions);
    box.append(card);
  });

  if (ok.length === 2 && !ok[0].r.demo) {
    const [x, y] = ok.map((o) => o.r);
    const verdict = document.createElement("p");
    verdict.className = "verdict";
    const cheap = x.costUsd != null && y.costUsd != null && x.costUsd !== y.costUsd
      ? (() => { const [lo, hi] = x.costUsd < y.costUsd ? [x, y] : [y, x]; return `${modelLabel(lo.model)} was ${lo.costUsd > 0 ? (hi.costUsd / lo.costUsd).toFixed(1) + "× cheaper" : "free"}`; })()
      : "Same price";
    const fast = x.ms < y.ms ? x : y;
    verdict.textContent = `${cheap}; ${modelLabel(fast.model)} answered ${(Math.abs(x.ms - y.ms) / 1000).toFixed(1)} s faster. Duel total: ${usd((x.costUsd || 0) + (y.costUsd || 0))}.`;
    box.append(verdict);
  }
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  renderForm();
  $("#theme").addEventListener("click", () => {
    const next = THEMES[$("#theme").dataset.theme || "auto"].next;
    save(KEYS.theme, applyTheme(next));
  });
  await connect();
  applyTheme(await load(KEYS.theme, $("#theme").dataset.theme || "auto"));
  state.engine = { ...state.engine, ...(await load(KEYS.engine, {})) };
  state.spend = { ...state.spend, ...(await load(KEYS.spend, {})) };
  renderEngine();
  for (const id of ["#model-write", "#model-rewrite", "#duel-b", "#cap"]) $(id).addEventListener("change", readEngine);
  $("#meter-reset").addEventListener("click", () => {
    state.spend = { usd: 0, requests: 0, tokens: 0, unpriced: 0, since: Date.now() };
    save(KEYS.spend, state.spend);
    renderMeter();
    toast("Spend meter reset");
  });
  $("#duel-go").addEventListener("click", duel);

  state.brands = await load(KEYS.brands, [DEFAULT_BRAND]);
  if (!Array.isArray(state.brands) || !state.brands.length) state.brands = [DEFAULT_BRAND];
  state.activeBrandId = await load(KEYS.activeBrand, state.brands[0].id);
  state.history = (await load(KEYS.history, [])) || [];
  renderBrands();
  renderHistory();

  const last = await load(KEYS.last, null);
  if (last) applyBrief(last);
  else document.querySelector('#platforms input[value="instagram"]').checked = true;

  $("#brief").addEventListener("submit", generate);

  $("#brand").addEventListener("change", (e) => {
    if (e.target.value === "__new") {
      e.target.value = state.activeBrandId;
      openBrandDialog(null);
      return;
    }
    state.activeBrandId = e.target.value;
    save(KEYS.activeBrand, state.activeBrandId);
  });
  $("#edit-brand").addEventListener("click", () => openBrandDialog(activeBrand()));
  $("#brand-form").addEventListener("submit", (e) => { e.preventDefault(); commitBrand(false); });
  $("#b-new").addEventListener("click", () => commitBrand(true));
  $("#b-cancel").addEventListener("click", () => $("#brand-dialog").close());
  $("#b-delete").addEventListener("click", async () => {
    const id = $("#brand-dialog").dataset.editing;
    state.brands = state.brands.filter((b) => b.id !== id);
    state.activeBrandId = state.brands[0].id;
    await save(KEYS.brands, state.brands);
    await save(KEYS.activeBrand, state.activeBrandId);
    renderBrands();
    $("#brand-dialog").close();
    toast("Brand voice deleted");
  });

  if (!state.online) setStatus(`Demo mode: showing sample copy. ${state.offlineReason || ""}`.trim());
}

boot();
