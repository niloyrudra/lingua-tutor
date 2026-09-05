import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, trimHistory } from "../utils/tokens.js";

test("estimateTokens counts latin chars and CJK correctly", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("Hello world"), Math.ceil(11 / 4));
  assert.equal(estimateTokens("日本語"), 3);
  const mixed = "Hallo 世界";
  assert.equal(estimateTokens(mixed), Math.ceil(6 / 4) + 2);
});

test("trimHistory returns empty when no messages", () => {
  const result = trimHistory([], "system", 1000);
  assert.deepEqual(result.messages, []);
  assert.ok(result.tokensUsed > 0);
});

test("trimHistory keeps everything within a large budget", () => {
  const messages = [
    { role: "user", content: "a".repeat(20) },
    { role: "assistant", content: "b".repeat(20) },
  ];
  const { messages: out, tokensUsed } = trimHistory(messages, "sys", 100000);
  assert.equal(out.length, 2);
  assert.ok(tokensUsed <= 100000);
});

test("trimHistory drops the middle, keeps oldest + newest", () => {
  const first = { role: "user", content: "opening" };
  const second = { role: "assistant", content: "scene" };
  const middle = { role: "user", content: "x".repeat(2000) }; // huge — will be dropped
  const last = { role: "assistant", content: "recent" };
  const messages = [first, second, middle, last];

  const { messages: out } = trimHistory(messages, "sys", 500);
  const contents = out.map(m => m.content);
  assert.ok(contents.includes("opening"));
  assert.ok(contents.includes("scene"));
  assert.ok(contents.includes("recent"));
  assert.ok(!contents.includes("x".repeat(2000)));
});
