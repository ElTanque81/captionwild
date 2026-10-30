// Well-known, inexpensive chat models that are good at short marketing copy.
// Used to pick a sensible default when the catalog lists many models.
export const PREFERRED = [
  /gpt-4\.1-mini/i, /gpt-4o-mini/i, /gpt-5-mini/i, /gpt-5\.\d-mini/i,
  /claude-haiku/i, /gemini-[\d.]+-flash(?!-lite)/i, /mistral-small/i,
  /llama-3\.3-70b/i, /qwen3?-.*(instruct|chat)/i, /deepseek-(v3|chat)/i,
];

export function preferenceRank(id) {
  const i = PREFERRED.findIndex((re) => re.test(id));
  return i === -1 ? 999 : i;
}
