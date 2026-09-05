import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSessionConfig, assertSessionId } from "../utils/validate.js";
import { AppError } from "../services/AppError.js";

test("validateSessionConfig applies defaults for empty input", () => {
  const config = validateSessionConfig({});
  assert.equal(config.targetLanguage, "de");
  assert.equal(config.conversationType, "job_interview");
  assert.equal(config.subtype, "general");
  assert.equal(config.level, "b1");
  assert.equal(config.tutorStyle, "encouraging");
  assert.equal(config.nativeLanguage, "English");
});

test("validateSessionConfig accepts a fully valid config", () => {
  const config = validateSessionConfig({
    targetLanguage: "fr",
    conversationType: "daily_life",
    subtype: "cafe",
    level: "a2",
    tutorStyle: "socratic",
    nativeLanguage: "English",
  });
  assert.equal(config.targetLanguage, "fr");
  assert.equal(config.subtype, "cafe");
});

test("validateSessionConfig rejects unknown values with VALIDATION error", () => {
  for (const bad of [
    { targetLanguage: "xx" },
    { conversationType: "nope" },
    { level: "z9" },
    { tutorStyle: "robot" },
    { conversationType: "daily_life", subtype: "bogus" },
  ]) {
    assert.throws(
      () => validateSessionConfig(bad),
      err => {
        assert.equal(err.code, "VALIDATION");
        assert.equal(err.status, 400);
        return true;
      }
    );
  }
});

test("assertSessionId rejects garbage ids", () => {
  assert.throws(() => assertSessionId("../../etc/passwd"), AppError);
  assert.throws(() => assertSessionId("abc"), AppError);
  assert.doesNotThrow(() => assertSessionId("a1b2c3d4-e5f6-4a5b-8c9d-0123456789ab"));
});
