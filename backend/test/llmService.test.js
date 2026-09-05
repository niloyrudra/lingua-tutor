import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOllamaResponse } from "../services/llmService.js";

test("parses single JSON /api/chat shape", () => {
  const result = parseOllamaResponse(JSON.stringify({ message: { role: "assistant", content: "Hallo!" } }));
  assert.equal(result.text, "Hallo!");
  assert.equal(result.provider, "ollama");
});

test("parses /api/generate {response} shape", () => {
  const result = parseOllamaResponse(JSON.stringify({ response: "Guten Morgen" }));
  assert.equal(result.text, "Guten Morgen");
});

test("parses NDJSON stream", () => {
  const ndjson = [
    JSON.stringify({ message: { content: "Wilkommen " } }),
    JSON.stringify({ message: { content: "im Kurs!" } }),
  ].join("\n");
  const result = parseOllamaResponse(ndjson);
  assert.equal(result.text, "Wilkommen im Kurs!");
});

test("skips malformed NDJSON lines", () => {
  const ndjson = ["not json at all", JSON.stringify({ response: "ok" })].join("\n");
  const result = parseOllamaResponse(ndjson);
  assert.equal(result.text, "ok");
});

test("returns null for empty / null content", () => {
  assert.equal(parseOllamaResponse(""), null);
  assert.equal(parseOllamaResponse(JSON.stringify({ message: {} })), null);
  assert.equal(parseOllamaResponse("   "), null);
});
