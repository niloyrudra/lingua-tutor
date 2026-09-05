/**
 * Token-budget helpers. Small local models (e.g. llama3.2) have a 4k-context
 * window, so a naive "last N messages" strategy can overflow the window
 * mid-conversation. We estimate tokens and keep the oldest scene-setting turns
 * plus the most recent exchanges that fit inside the budget.
 */

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;

export function estimateTokens(text) {
  if (!text) return 0;
  const cjk = (String(text).match(CJK_RE) || []).length;
  const rest = String(text).length - cjk;
  // Rough heuristic: ~4 latin chars/token, ~1 CJK char/token.
  return Math.ceil(rest / 4 + cjk);
}

/**
 * Trims a message list to fit inside `maxTokens` (including the system prompt).
 * Strategy: keep the oldest turns (scene-setting) plus the newest turns, and
 * drop from the middle first.
 *
 * @param {Array<{role:string, content:string}>} messages
 * @param {string} systemPrompt
 * @param {number} maxTokens
 * @returns {{ messages: Array<{role:string, content:string}>, tokensUsed: number }}
 */
export function trimHistory(messages, systemPrompt, maxTokens) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages: [], tokensUsed: estimateTokens(systemPrompt || "") };
  }

  const systemTokens = estimateTokens(systemPrompt || "");
  const budget = Math.max(maxTokens - systemTokens, 100);

  const prefix = messages.slice(0, 2); // scene-setting turns (always preferred)
  const suffix = messages.length > 2 ? messages.slice(2) : [];

  const fit = list => {
    const picked = [];
    let used = 0;
    for (const m of list) {
      const t = estimateTokens(m.content) + 4; // small per-message overhead
      if (used + t > budget) break;
      picked.push(m);
      used += t;
    }
    return { picked, used };
  };

  const pre = fit(prefix);
  const suf = fit([...suffix].reverse());
  const messagesOut = [...pre.picked, ...suf.picked.reverse()];
  return { messages: messagesOut, tokensUsed: pre.used + suf.used + systemTokens };
}
