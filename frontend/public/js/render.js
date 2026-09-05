/**
 * Safe DOM renderer for tutor messages. Never assigns untrusted text through
 * innerHTML/innerText — every token goes through textContent, so `<img
 * onerror=...>` arriving from the LLM is rendered as inert text.
 */
(function attachRender() {
  const INLINE_TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*)/;

  function buildInline(text) {
    const span = document.createElement("span");
    let rest = text;
    while (rest) {
      const match = rest.match(INLINE_TOKEN);
      if (!match) {
        if (rest) span.appendChild(document.createTextNode(rest));
        break;
      }
      if (match.index > 0) span.appendChild(document.createTextNode(rest.slice(0, match.index)));

      const token = match[0];
      const bold = token.startsWith("**");
      const inner = token.slice(bold ? 2 : 1, token.length - (bold ? 2 : 1));
      const el = document.createElement(bold ? "strong" : "em");
      el.textContent = inner;
      span.appendChild(el);

      rest = rest.slice(match.index + token.length);
    }
    return span;
  }

  /**
   * Renders markdown-ish text (bold/italic/newlines) into a DocumentFragment.
   * @param {string} text
   * @returns {DocumentFragment}
   */
  function renderMarkdown(text) {
    const fragment = document.createDocumentFragment();
    if (!text) return fragment;

    const lines = String(text).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (i > 0) fragment.appendChild(document.createElement("br"));
      fragment.appendChild(buildInline(line));
    });
    return fragment;
  }

  /**
   * Extracts a one-line vocab tip (💡) from a tutor reply, returning the
   * remaining text and the tip. Purposefully simple and safe.
   * @param {string} text
   * @returns {{ main: string, vocab: string|null }}
   */
  function extractVocabTip(text) {
    const raw = String(text);
    const lines = raw.split(/\r?\n/);
    const idx = lines.findIndex(l => l.includes("💡"));
    if (idx === -1) return { main: raw, vocab: null };
    const [tipLine] = lines.splice(idx, 1);
    return { main: lines.join("\n").trim(), vocab: tipLine.replace(/^.*?💡\s*/, "💡 ").trim() };
  }

  window.renderMarkdown = renderMarkdown;
  window.extractVocabTip = extractVocabTip;
})();
