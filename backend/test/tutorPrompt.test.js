import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../prompts/tutorPrompt.js";
import { LANGUAGES, CONVERSATION_TYPES, LEVELS, TUTOR_STYLES } from "../config/languages.js";

test("buildSystemPrompt succeeds for every valid configuration combination", () => {
  let count = 0;
  for (const lang of Object.keys(LANGUAGES)) {
    for (const type of Object.keys(CONVERSATION_TYPES)) {
      for (const subtype of Object.keys(CONVERSATION_TYPES[type].subtypes)) {
        for (const level of Object.keys(LEVELS)) {
          for (const style of Object.keys(TUTOR_STYLES)) {
            const prompt = buildSystemPrompt({
              targetLanguage: lang,
              conversationType: type,
              subtype,
              level,
              tutorStyle: style,
              nativeLanguage: "English",
            });
            assert.ok(typeof prompt === "string" && prompt.length > 50, `short prompt for ${lang}/${type}/${level}`);
            assert.ok(prompt.includes("LINGUA"), "prompt must declare the tutor persona");
            count++;
          }
        }
      }
    }
  }
  // Just to make the combinatorics visible in test output.
  assert.ok(count > 1000, `expected >1000 combinations, got ${count}`);
});
