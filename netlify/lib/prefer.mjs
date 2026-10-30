// Models verified to answer on our Otari account (via /api/health?probe=1),
// shown first under "Recommended". The first is the default writing model,
// the second the default duel opponent. Open-weight models, served by Otari.
export const RECOMMENDED = [
  "mistralai/mistral-small-3.2-24b-instruct-2506",
  "alibaba/qwen3-235b-a22b-instruct-2507",
  "meta/llama-3.3-70b-turbo",
  "mistralai/mistral-small-4",
  "meta/llama-3.3-70b-instruct",
  "mistralai/mistral-small-latest",
];

// Well-known, inexpensive chat models that are good at short marketing copy.
export const PREFERRED = [
  /mistral-small/i, /gpt-4\.1-mini/i, /gpt-4o-mini/i, /gpt-5-mini/i,
  /claude-haiku/i, /gemini-[\d.]+-flash(?!-lite)/i,
  /llama-3\.3-70b-(instruct|turbo)/i, /qwen3?-.*instruct/i, /deepseek-(v3|chat)/i,
];

export function preferenceRank(id) {
  const r = RECOMMENDED.indexOf(id);
  if (r !== -1) return r;
  const i = PREFERRED.findIndex((re) => re.test(id));
  return i === -1 ? 999 : 100 + i;
}
