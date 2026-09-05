/**
 * Input validation. Every request-supplied value is whitelisted against the
 * supported language/scenario/level/style catalogs instead of being passed
 * through to the prompt builder or the LLM unchecked.
 */
import { LANGUAGES, CONVERSATION_TYPES, LEVELS, TUTOR_STYLES } from "../config/languages.js";
import { AppError } from "../services/AppError.js";

/**
 * Validates and normalizes a session creation payload.
 * @param {object} input
 * @returns {object} canonical SessionConfig with defaults applied
 * @throws {AppError} VALIDATION when any field is unknown
 */
export function validateSessionConfig(input = {}) {
  const conv = CONVERSATION_TYPES[input.conversationType || "job_interview"];
  const subtypes = conv?.subtypes;
  // Pick the scenario's "general" subtype when one exists, else its first option.
  let subtype = input.subtype || "";
  if (!subtype && subtypes) subtype = subtypes.general ? "general" : Object.keys(subtypes)[0];

  const config = {
    targetLanguage: input.targetLanguage || "de",
    conversationType: input.conversationType || "job_interview",
    subtype: subtype || "general",
    level: input.level || "b1",
    tutorStyle: input.tutorStyle || "encouraging",
    nativeLanguage:
      typeof input.nativeLanguage === "string" && input.nativeLanguage.trim()
        ? input.nativeLanguage.trim().slice(0, 50)
        : "English",
  };

  const errors = [];
  if (!LANGUAGES[config.targetLanguage]) {
    errors.push(`Unknown targetLanguage: "${config.targetLanguage}"`);
  }
  if (!CONVERSATION_TYPES[config.conversationType]) {
    errors.push(`Unknown conversationType: "${config.conversationType}"`);
  }
  if (subtypes && !subtypes[config.subtype]) {
    errors.push(`Unknown subtype: "${config.subtype}" for "${config.conversationType}"`);
  }
  if (!LEVELS[config.level]) {
    errors.push(`Unknown level: "${config.level}"`);
  }
  if (!TUTOR_STYLES[config.tutorStyle]) {
    errors.push(`Unknown tutorStyle: "${config.tutorStyle}"`);
  }

  if (errors.length) throw AppError.validation(errors.join("; "));
  return config;
}

const SESSION_ID_RE = /^[0-9a-f-]{8,64}$/i;

export function assertSessionId(id) {
  if (typeof id !== "string" || !SESSION_ID_RE.test(id)) {
    throw AppError.validation("Invalid session id");
  }
}
