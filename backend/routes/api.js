/**
 * API routes for session lifecycle and the speech ↔ text pipeline.
 *
 * Each pipeline turn is wrapped in a per-session lock so overlapping requests
 * cannot interleave turns and corrupt the LLM context (see sessionManager).
 */
import express from "express";
import multer from "multer";
import { env } from "../config/env.js";
import { AppError } from "../services/AppError.js";
import { log } from "../services/logger.js";
import {
  createSession,
  getSession,
  addTurn,
  getMessagesForLLM,
  deleteSession,
  withSessionLock,
  sessionCount,
} from "../services/sessionManager.js";
import { transcribeAudio } from "../services/sttService.js";
import { getLLMResponse } from "../services/llmService.js";
import { synthesizeSpeech } from "../services/ttsService.js";
import { LANGUAGES, CONVERSATION_TYPES, LEVELS, TUTOR_STYLES } from "../config/languages.js";
import { assertSessionId } from "../utils/validate.js";
import { rateLimit, strictRateLimit } from "../middleware/rateLimit.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(rateLimit({ prefix: "api", limit: 120, windowMs: 60_000 }));

// Wraps async handlers so rejections reach the central error handler.
const asyncRoute = fn => (req, res, next) => fn(req, res, next).catch(next);

function requireSession(req) {
  assertSessionId(req.params.id);
  const session = getSession(req.params.id);
  if (!session) throw AppError.notFound("Session not found");
  return session;
}

// ─── Config endpoint (for the UI dropdowns) ──────────────────────────────────
router.get("/config", (req, res) => {
  res.json({ languages: LANGUAGES, conversationTypes: CONVERSATION_TYPES, levels: LEVELS, tutorStyles: TUTOR_STYLES });
});

// ─── Voices endpoint (proxy to TTS service) ──────────────────────────────────
router.get("/voices", asyncRoute(async (req, res) => {
  const { language } = req.query;
  const url = `${env.TTS_SERVICE_URL}/voices${language ? `?language=${language}` : ""}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw AppError.upstream(`TTS voices error ${response.status}`);
  res.json(await response.json());
}));

// ─── Dictionary proxy (Free Dictionary API + local fallback) ───────────────────
const LOCAL_DICT = {
  "hello": [{ pos: "exclamation", def: "used as a greeting" }, { pos: "noun", def: "a greeting" }],
  "good": [{ pos: "adjective", def: "to be desired or approved of" }, { pos: "noun", def: "that which is morally right" }],
  "morning": [{ pos: "noun", def: "the early part of the day" }],
  "evening": [{ pos: "noun", def: "the later part of the day" }],
  "thank": [{ pos: "verb", def: "express gratitude to someone" }],
  "please": [{ pos: "adverb", def: "used in polite requests" }],
  "yes": [{ pos: "adverb", def: "used to give an affirmative response" }],
  "no": [{ pos: "adverb", def: "used to give a negative response" }],
  "water": [{ pos: "noun", def: "a colorless, transparent, odorless liquid" }],
  "food": [{ pos: "noun", def: "any nutritious substance that people eat" }],
  "house": [{ pos: "noun", def: "a building for human habitation" }],
  "car": [{ pos: "noun", def: "a road vehicle with an engine" }],
  "book": [{ pos: "noun", def: "a written or printed work" }],
  "friend": [{ pos: "noun", def: "a person with whom one has a bond of mutual affection" }],
  "family": [{ pos: "noun", def: "a group consisting of parents and children" }],
  "work": [{ pos: "verb", def: "be engaged in physical or mental activity" }, { pos: "noun", def: "activity involving effort" }],
  "play": [{ pos: "verb", def: "engage in activity for enjoyment" }, { pos: "noun", def: "activity for enjoyment" }],
  "read": [{ pos: "verb", def: "look at and comprehend the meaning of written matter" }],
  "write": [{ pos: "verb", def: "mark letters or words on a surface" }],
  "speak": [{ pos: "verb", def: "say something to convey information" }],
  "listen": [{ pos: "verb", def: "give attention to sound" }],
  "understand": [{ pos: "verb", def: "perceive the intended meaning of" }],
  "learn": [{ pos: "verb", def: "gain knowledge or skill" }],
  "study": [{ pos: "verb", def: "devote time to acquiring knowledge" }],
  "teacher": [{ pos: "noun", def: "a person who teaches" }],
  "student": [{ pos: "noun", def: "a person who is studying" }],
  "language": [{ pos: "noun", def: "a system of communication" }],
  "word": [{ pos: "noun", def: "a single distinct meaningful element of speech" }],
  "sentence": [{ pos: "noun", def: "a set of words that is complete in itself" }],
  "question": [{ pos: "noun", def: "a sentence worded to elicit information" }],
  "answer": [{ pos: "noun", def: "a thing said in reply to a question" }],
  "time": [{ pos: "noun", def: "the indefinite continued progress of existence" }],
  "day": [{ pos: "noun", def: "a period of twenty-four hours" }],
  "week": [{ pos: "noun", def: "a period of seven days" }],
  "month": [{ pos: "noun", def: "a period of about four weeks" }],
  "year": [{ pos: "noun", def: "the time taken by the earth to orbit the sun" }],
  "today": [{ pos: "adverb", def: "on this day" }],
  "tomorrow": [{ pos: "adverb", def: "on the day after today" }],
  "yesterday": [{ pos: "adverb", def: "on the day before today" }],
  "now": [{ pos: "adverb", def: "at the present time" }],
  "later": [{ pos: "adverb", def: "at a time in the future" }],
  "early": [{ pos: "adverb", def: "before the usual or expected time" }],
  "late": [{ pos: "adverb", def: "after the usual or expected time" }],
  "here": [{ pos: "adverb", def: "in, at, or to this place" }],
  "there": [{ pos: "adverb", def: "in, at, or to that place" }],
  "where": [{ pos: "adverb", def: "in or to what place" }],
  "who": [{ pos: "pronoun", def: "what person or people" }],
  "what": [{ pos: "pronoun", def: "asking for information specifying something" }],
  "why": [{ pos: "adverb", def: "for what reason" }],
  "how": [{ pos: "adverb", def: "in what way or manner" }],
  "much": [{ pos: "adverb", def: "to a great extent" }, { pos: "determiner", def: "a large amount" }],
  "many": [{ pos: "determiner", def: "a large number of" }],
  "few": [{ pos: "determiner", def: "a small number of" }],
  "little": [{ pos: "adjective", def: "small in size or amount" }],
  "big": [{ pos: "adjective", def: "of considerable size" }],
  "small": [{ pos: "adjective", def: "of a size less than normal" }],
  "new": [{ pos: "adjective", def: "not existing before" }],
  "old": [{ pos: "adjective", def: "having lived for a long time" }],
  "young": [{ pos: "adjective", def: "having lived for a short time" }],
  "hot": [{ pos: "adjective", def: "having a high temperature" }],
  "cold": [{ pos: "adjective", def: "having a low temperature" }],
  "beautiful": [{ pos: "adjective", def: "pleasing the senses or mind aesthetically" }],
  "ugly": [{ pos: "adjective", def: "unpleasant or repulsive in appearance" }],
  "happy": [{ pos: "adjective", def: "feeling or showing pleasure" }],
  "sad": [{ pos: "adjective", def: "feeling or showing sorrow" }],
  "angry": [{ pos: "adjective", def: "feeling or showing strong annoyance" }],
  "tired": [{ pos: "adjective", def: "in need of sleep or rest" }],
  "love": [{ pos: "verb", def: "feel deep affection for" }, { pos: "noun", def: "an intense feeling of deep affection" }],
  "like": [{ pos: "verb", def: "find agreeable or enjoyable" }, { pos: "preposition", def: "having the same characteristics as" }],
  "want": [{ pos: "verb", def: "have a desire to possess or do something" }],
  "need": [{ pos: "verb", def: "require something because it is essential" }],
  "have": [{ pos: "verb", def: "possess, own, or hold" }],
  "make": [{ pos: "verb", def: "form or create something" }],
  "do": [{ pos: "verb", def: "perform an action" }],
  "go": [{ pos: "verb", def: "move from one place to another" }],
  "come": [{ pos: "verb", def: "move toward the speaker" }],
  "take": [{ pos: "verb", def: "lay hold of something" }],
  "give": [{ pos: "verb", def: "freely transfer the possession of" }],
  "get": [{ pos: "verb", def: "come to have or receive" }],
  "see": [{ pos: "verb", def: "perceive with the eyes" }],
  "know": [{ pos: "verb", def: "be aware of through observation" }],
  "think": [{ pos: "verb", def: "have a particular opinion or belief" }],
  "say": [{ pos: "verb", def: "utter words to convey information" }],
  "tell": [{ pos: "verb", def: "communicate information" }],
  "ask": [{ pos: "verb", def: "say something in order to obtain an answer" }],
  "help": [{ pos: "verb", def: "make it easier for someone to do something" }],
  "use": [{ pos: "verb", def: "take, hold, or deploy something" }],
  "find": [{ pos: "verb", def: "discover or perceive by chance" }],
  "look": [{ pos: "verb", def: "direct one's gaze toward something" }],
  "try": [{ pos: "verb", def: "make an attempt" }],
  "call": [{ pos: "verb", def: "cry out to someone" }],
  "feel": [{ pos: "verb", def: "experience a sensation or emotion" }],
  "become": [{ pos: "verb", def: "begin to be" }],
  "leave": [{ pos: "verb", def: "go away from a place" }],
  "put": [{ pos: "verb", def: "move to or place in a particular position" }],
  "mean": [{ pos: "verb", def: "intend to convey or indicate" }],
  "keep": [{ pos: "verb", def: "retain possession of" }],
  "let": [{ pos: "verb", def: "allow someone to do something" }],
  "begin": [{ pos: "verb", def: "start to happen or exist" }],
  "seem": [{ pos: "verb", def: "give the impression of being something" }],
  "show": [{ pos: "verb", def: "make visible or noticeable" }],
  "hear": [{ pos: "verb", def: "perceive sound with the ear" }],
  "run": [{ pos: "verb", def: "move at a speed faster than a walk" }],
  "walk": [{ pos: "verb", def: "move at a regular pace by lifting and setting down each foot" }],
  "sit": [{ pos: "verb", def: "adopt a posture with the body supported by the buttocks" }],
  "stand": [{ pos: "verb", def: "be in an upright position on the feet" }],
  "sleep": [{ pos: "verb", def: "rest with eyes closed and consciousness suspended" }],
  "wake": [{ pos: "verb", def: "emerge from sleep" }],
  "eat": [{ pos: "verb", def: "put food into the mouth and chew and swallow" }],
  "drink": [{ pos: "verb", def: "take liquid into the mouth and swallow" }],
  "cook": [{ pos: "verb", def: "prepare food by heating it" }],
  "buy": [{ pos: "verb", def: "obtain in exchange for payment" }],
  "sell": [{ pos: "verb", def: "give or hand over in exchange for money" }],
  "pay": [{ pos: "verb", def: "give money in exchange for goods or services" }],
  "cost": [{ pos: "verb", def: "require the payment of a specified sum" }],
  "price": [{ pos: "noun", def: "the amount of money expected for something" }],
  "money": [{ pos: "noun", def: "a current medium of exchange" }],
  "shop": [{ pos: "noun", def: "a building where goods are sold" }, { pos: "verb", def: "visit shops for purchasing goods" }],
  "store": [{ pos: "noun", def: "a place where goods are kept" }, { pos: "verb", def: "keep or set aside for future use" }],
  "market": [{ pos: "noun", def: "a regular gathering for buying and selling" }],
  "bank": [{ pos: "noun", def: "a financial institution" }],
  "hospital": [{ pos: "noun", def: "an institution providing medical care" }],
  "doctor": [{ pos: "noun", def: "a person qualified to practice medicine" }],
  "medicine": [{ pos: "noun", def: "a substance used to treat illness" }],
  "head": [{ pos: "noun", def: "the upper part of the human body" }],
  "hand": [{ pos: "noun", def: "the end part of the arm" }],
  "foot": [{ pos: "noun", def: "the lower extremity of the leg" }],
  "eye": [{ pos: "noun", def: "the organ of sight" }],
  "ear": [{ pos: "noun", def: "the organ of hearing" }],
  "mouth": [{ pos: "noun", def: "the opening in the face for eating and speaking" }],
  "nose": [{ pos: "noun", def: "the organ of smell" }],
  "hair": [{ pos: "noun", def: "fine threadlike strands growing from the skin" }],
  "face": [{ pos: "noun", def: "the front part of the head" }],
  "name": [{ pos: "noun", def: "a word by which a person is known" }],
  "man": [{ pos: "noun", def: "an adult human male" }],
  "woman": [{ pos: "noun", def: "an adult human female" }],
  "child": [{ pos: "noun", def: "a young human being" }],
  "boy": [{ pos: "noun", def: "a male child" }],
  "girl": [{ pos: "noun", def: "a female child" }],
  "person": [{ pos: "noun", def: "a human being" }],
  "people": [{ pos: "noun", def: "human beings in general" }],
  "enemy": [{ pos: "noun", def: "a person who is actively opposed to someone" }],
  "team": [{ pos: "noun", def: "a group of players forming one side" }],
  "group": [{ pos: "noun", def: "a number of people or things together" }],
  "company": [{ pos: "noun", def: "a commercial business" }],
  "school": [{ pos: "noun", def: "an institution for educating children" }],
  "university": [{ pos: "noun", def: "an institution of higher education" }],
  "class": [{ pos: "noun", def: "a group of students taught together" }],
  "lesson": [{ pos: "noun", def: "a period of learning or teaching" }],
  "homework": [{ pos: "noun", def: "schoolwork assigned to be done at home" }],
  "exam": [{ pos: "noun", def: "a formal test of knowledge" }],
  "test": [{ pos: "noun", def: "a procedure to evaluate knowledge" }],
  "grade": [{ pos: "noun", def: "a mark indicating quality or level" }],
  "pass": [{ pos: "verb", def: "succeed in an examination" }],
  "fail": [{ pos: "verb", def: "be unsuccessful in an examination" }],
};

// ─── German → English Dictionary ───────────────────────────────────────────────
const LOCAL_DICT_DE = {
  "hallo": [{ pos: "interjection", def: "hello" }],
  "guten": [{ pos: "adjective", def: "good" }],
  "morgen": [{ pos: "noun", def: "morning" }],
  "tag": [{ pos: "noun", def: "day" }],
  "abend": [{ pos: "noun", def: "evening" }],
  "nacht": [{ pos: "noun", def: "night" }],
  "danke": [{ pos: "interjection", def: "thank you" }],
  "bitte": [{ pos: "adverb", def: "please / you're welcome" }],
  "ja": [{ pos: "adverb", def: "yes" }],
  "nein": [{ pos: "adverb", def: "no" }],
  "wasser": [{ pos: "noun", def: "water" }],
  "essen": [{ pos: "noun", def: "food" }, { pos: "verb", def: "to eat" }],
  "trinken": [{ pos: "verb", def: "to drink" }],
  "haus": [{ pos: "noun", def: "house" }],
  "auto": [{ pos: "noun", def: "car" }],
  "buch": [{ pos: "noun", def: "book" }],
  "freund": [{ pos: "noun", def: "friend (male)" }],
  "freundin": [{ pos: "noun", def: "friend (female)" }],
  "familie": [{ pos: "noun", def: "family" }],
  "arbeit": [{ pos: "noun", def: "work" }, { pos: "verb", def: "to work" }],
  "spielen": [{ pos: "verb", def: "to play" }],
  "lesen": [{ pos: "verb", def: "to read" }],
  "schreiben": [{ pos: "verb", def: "to write" }],
  "sprechen": [{ pos: "verb", def: "to speak" }],
  "hören": [{ pos: "verb", def: "to hear / to listen" }],
  "verstehen": [{ pos: "verb", def: "to understand" }],
  "lernen": [{ pos: "verb", def: "to learn" }],
  "studieren": [{ pos: "verb", def: "to study (university)" }],
  "lehrer": [{ pos: "noun", def: "teacher (male)" }],
  "lehrerin": [{ pos: "noun", def: "teacher (female)" }],
  "student": [{ pos: "noun", def: "student (male)" }],
  "studentin": [{ pos: "noun", def: "student (female)" }],
  "sprache": [{ pos: "noun", def: "language" }],
  "wort": [{ pos: "noun", def: "word" }],
  "satz": [{ pos: "noun", def: "sentence" }],
  "frage": [{ pos: "noun", def: "question" }],
  "antwort": [{ pos: "noun", def: "answer" }],
  "zeit": [{ pos: "noun", def: "time" }],
"heute": [{ pos: "adverb", def: "today" }],
  "später": [{ pos: "adverb", def: "later" }],
  "früh": [{ pos: "adverb", def: "early" }],
  "spät": [{ pos: "adverb", def: "late" }],
  "hier": [{ pos: "adverb", def: "here" }],
  "dort": [{ pos: "adverb", def: "there" }],
  "wo": [{ pos: "adverb", def: "where" }],
  "wer": [{ pos: "pronoun", def: "who" }],
  "was": [{ pos: "pronoun", def: "what" }],
  "warum": [{ pos: "adverb", def: "why" }],
  "wie": [{ pos: "adverb", def: "how" }],
  "viel": [{ pos: "adjective", def: "much / many" }],
  "wenig": [{ pos: "adjective", def: "little / few" }],
  "groß": [{ pos: "adjective", def: "big / large" }],
  "klein": [{ pos: "adjective", def: "small" }],
  "neu": [{ pos: "adjective", def: "new" }],
  "alt": [{ pos: "adjective", def: "old" }],
  "jung": [{ pos: "adjective", def: "young" }],
  "heiß": [{ pos: "adjective", def: "hot" }],
  "kalt": [{ pos: "adjective", def: "cold" }],
  "schön": [{ pos: "adjective", def: "beautiful" }],
  "hässlich": [{ pos: "adjective", def: "ugly" }],
  "glücklich": [{ pos: "adjective", def: "happy" }],
  "traurig": [{ pos: "adjective", def: "sad" }],
  "wütend": [{ pos: "adjective", def: "angry" }],
  "müde": [{ pos: "adjective", def: "tired" }],
  "liebe": [{ pos: "noun", def: "love" }, { pos: "verb", def: "to love" }],
  "mögen": [{ pos: "verb", def: "to like" }],
  "wollen": [{ pos: "verb", def: "to want" }],
  "brauchen": [{ pos: "verb", def: "to need" }],
  "haben": [{ pos: "verb", def: "to have" }],
  "machen": [{ pos: "verb", def: "to do / to make" }],
  "tun": [{ pos: "verb", def: "to do" }],
  "gehen": [{ pos: "verb", def: "to go" }],
  "kommen": [{ pos: "verb", def: "to come" }],
  "nehmen": [{ pos: "verb", def: "to take" }],
  "geben": [{ pos: "verb", def: "to give" }],
  "bekommen": [{ pos: "verb", def: "to get / to receive" }],
  "sehen": [{ pos: "verb", def: "to see" }],
  "wissen": [{ pos: "verb", def: "to know (facts)" }],
  "kennen": [{ pos: "verb", def: "to know (people/places)" }],
  "denken": [{ pos: "verb", def: "to think" }],
  "glauben": [{ pos: "verb", def: "to believe" }],
  "sagen": [{ pos: "verb", def: "to say" }],
  "erzählen": [{ pos: "verb", def: "to tell" }],
  "fragen": [{ pos: "verb", def: "to ask" }],
  "helfen": [{ pos: "verb", def: "to help" }],
  "benutzen": [{ pos: "verb", def: "to use" }],
  "finden": [{ pos: "verb", def: "to find" }],
  "suchen": [{ pos: "verb", def: "to search / to look for" }],
  "probieren": [{ pos: "verb", def: "to try" }],
  "anrufen": [{ pos: "verb", def: "to call" }],
  "fühlen": [{ pos: "verb", def: "to feel" }],
  "werden": [{ pos: "verb", def: "to become" }],
  "scheinen": [{ pos: "verb", def: "to seem" }],
  "zeigen": [{ pos: "verb", def: "to show" }],
  "laufen": [{ pos: "verb", def: "to run" }],
  "sitzen": [{ pos: "verb", def: "to sit" }],
  "stehen": [{ pos: "verb", def: "to stand" }],
  "schlafen": [{ pos: "verb", def: "to sleep" }],
  "aufwachen": [{ pos: "verb", def: "to wake up" }],
  "kochen": [{ pos: "verb", def: "to cook" }],
  "kaufen": [{ pos: "verb", def: "to buy" }],
  "verkaufen": [{ pos: "verb", def: "to sell" }],
  "bezahlen": [{ pos: "verb", def: "to pay" }],
  "kosten": [{ pos: "verb", def: "to cost" }],
  "preis": [{ pos: "noun", def: "price" }],
  "geld": [{ pos: "noun", def: "money" }],
  "laden": [{ pos: "noun", def: "shop / store" }],
  "geschäft": [{ pos: "noun", def: "shop / business" }],
  "markt": [{ pos: "noun", def: "market" }],
  "bank": [{ pos: "noun", def: "bank" }],
  "krankenhaus": [{ pos: "noun", def: "hospital" }],
  "arzt": [{ pos: "noun", def: "doctor (male)" }],
  "ärztin": [{ pos: "noun", def: "doctor (female)" }],
  "medizin": [{ pos: "noun", def: "medicine" }],
  "kopf": [{ pos: "noun", def: "head" }],
  "hand": [{ pos: "noun", def: "hand" }],
  "fuß": [{ pos: "noun", def: "foot" }],
  "auge": [{ pos: "noun", def: "eye" }],
  "ohr": [{ pos: "noun", def: "ear" }],
  "mund": [{ pos: "noun", def: "mouth" }],
  "nase": [{ pos: "noun", def: "nose" }],
  "haar": [{ pos: "noun", def: "hair" }],
  "gesicht": [{ pos: "noun", def: "face" }],
  "name": [{ pos: "noun", def: "name" }],
  "mann": [{ pos: "noun", def: "man" }],
  "frau": [{ pos: "noun", def: "woman" }],
  "kind": [{ pos: "noun", def: "child" }],
  "junge": [{ pos: "noun", def: "boy" }],
  "mädchen": [{ pos: "noun", def: "girl" }],
  "person": [{ pos: "noun", def: "person" }],
  "leute": [{ pos: "noun", def: "people" }],
  "feind": [{ pos: "noun", def: "enemy" }],
  "team": [{ pos: "noun", def: "team" }],
  "gruppe": [{ pos: "noun", def: "group" }],
  "firma": [{ pos: "noun", def: "company" }],
  "schule": [{ pos: "noun", def: "school" }],
  "universität": [{ pos: "noun", def: "university" }],
  "klasse": [{ pos: "noun", def: "class" }],
  "stunde": [{ pos: "noun", def: "hour / lesson" }],
  "hausaufgabe": [{ pos: "noun", def: "homework" }],
  "prüfung": [{ pos: "noun", def: "exam" }],
  "test": [{ pos: "noun", def: "test" }],
  "note": [{ pos: "noun", def: "grade" }],
  "bestehen": [{ pos: "verb", def: "to pass (exam)" }],
  "durchfallen": [{ pos: "verb", def: "to fail (exam)" }],
};

router.get("/dictionary/:word", strictRateLimit({ prefix: "dictionary", limit: 60, windowMs: 60_000 }), asyncRoute(async (req, res) => {
  const word = req.params.word.toLowerCase().replace(/[^a-zäöüß]/g, "");
  const lang = (req.query.lang || "en").toLowerCase();
  if (!word || word.length > 50) throw AppError.validation("Invalid word");

  async function tryDictAPI(w) {
    try {
      const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'lingua-tutor/1.0' },
      });
      if (!response.ok) return null;
      const data = await response.json();
      const entry = data[0];
      return entry?.meanings?.flatMap(m =>
        m.definitions?.slice(0, 2).map(d => ({ pos: m.partOfSpeech, def: d.definition }))
      ) || [];
    } catch { return null; }
  }

  // Try primary API (only for English)
  let defs = lang === "en" ? await tryDictAPI(word) : null;

  // Fallback to local dictionary based on language
  if (!defs || defs.length === 0) {
    if (lang === "de") {
      defs = LOCAL_DICT_DE[word] || [];
    } else {
      defs = LOCAL_DICT[word] || [];
    }
  }

  res.json({ definitions: (defs || []).slice(0, 3) });
}));

// ─── Active session count ─────────────────────────────────────────────────────
router.get("/sessions", (req, res) => {
  res.json({ activeSessions: sessionCount(), maxSessions: env.MAX_SESSIONS });
});

// ─── Create a new session ────────────────────────────────────────────────────
router.post(
  "/session",
  strictRateLimit({ prefix: "session-create", limit: 10, windowMs: 60_000 }),
  asyncRoute(async (req, res) => {
    const session = await createSession(req.body);
    res.json({ sessionId: session.id, config: session.config });
  })
);

// ─── Get session info ────────────────────────────────────────────────────────
router.get(
  "/session/:id",
  asyncRoute(async (req, res) => {
    const session = requireSession(req);
    res.json({
      sessionId: session.id,
      config: session.config,
      stats: session.stats,
      turnCount: session.turnCount,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
    });
  })
);

// ─── Start session (get opening message from tutor) ──────────────────────────
router.post(
  "/session/:id/start",
asyncRoute(async (req, res) => {
    const session = requireSession(req);
    const voiceId = req.query.voice || null;
    const speed = req.query.speed ? parseFloat(req.query.speed) : undefined;
    const llmResult = await withSessionLock(session.id, async () => {
      await addTurn(session.id, "user", "START_SESSION");
      const { systemPrompt, messages } = getMessagesForLLM(session.id);
      const result = await getLLMResponse(systemPrompt, messages);
      await addTurn(session.id, "assistant", result.text);
      return result;
    });

    const ttsResult = await synthesizeSpeech(llmResult.text, session.config.targetLanguage, voiceId, speed);
    res.json({
      text: llmResult.text,
      audioUrl: `/api/audio/${ttsResult.audioId}`,
      mimeType: ttsResult.mimeType,
      provider: { llm: llmResult.provider, tts: ttsResult.provider },
    });
  })
);

// ─── Main pipeline: audio in → text → LLM → audio out ───────────────────────
router.post(
  "/session/:id/speak",
  upload.single("audio"),
  strictRateLimit({ prefix: "session-speak", limit: 30, windowMs: 60_000 }),
  asyncRoute(async (req, res) => {
    const started = Date.now();
    const session = requireSession(req);
    if (!req.file) throw AppError.validation("No audio file uploaded");

    // Step 1: Speech-to-Text (no session mutation, safe outside the lock)
    const langInfo = LANGUAGES[session.config.targetLanguage];
    const whisperCode = session.config.targetLanguage === "auto" ? "auto" : langInfo?.whisperCode || "auto";
    const sttResult = await transcribeAudio(req.file.buffer, whisperCode);
    log.info("Pipeline step 1/3 done", { sessionId: session.id, ms: Date.now() - started });

    if (!sttResult.transcript || sttResult.transcript.trim().length < 2) {
      return res.json({
        transcript: "",
        text: "I didn't catch that — could you try again?",
        audioUrl: null,
        empty: true,
      });
    }

    // Step 2: LLM response (serialized per session so turns stay ordered)
    const llmResult = await withSessionLock(session.id, async () => {
      await addTurn(session.id, "user", sttResult.transcript);
      const { systemPrompt, messages } = getMessagesForLLM(session.id);
      const result = await getLLMResponse(systemPrompt, messages);
      await addTurn(session.id, "assistant", result.text);
      return result;
    });
    log.info("Pipeline step 2/3 done", { sessionId: session.id, ms: Date.now() - started });

    // Step 3: Text-to-Speech (disk cached per unique sentence)
    const voiceId = req.query.voice || null;
    const speed = req.query.speed ? parseFloat(req.query.speed) : undefined;
    const ttsResult = await synthesizeSpeech(llmResult.text, session.config.targetLanguage, voiceId, speed);
    log.info("Pipeline done", { sessionId: session.id, ms: Date.now() - started });

    res.json({
      transcript: sttResult.transcript,
      text: llmResult.text,
      audioUrl: `/api/audio/${ttsResult.audioId}`,
      mimeType: ttsResult.mimeType,
      timing: { total: Date.now() - started },
      providers: { stt: sttResult.provider, llm: llmResult.provider, tts: ttsResult.provider },
    });
  })
);

// ─── Text input (fallback for testing without mic) ───────────────────────────
router.post(
  "/session/:id/text",
  strictRateLimit({ prefix: "session-text", limit: 30, windowMs: 60_000 }),
  asyncRoute(async (req, res) => {
    const session = requireSession(req);
    const { message } = req.body;
    const voiceId = req.query.voice || req.body.voice || null;
    const speed = req.query.speed ? parseFloat(req.query.speed) : (req.body.speed ? parseFloat(req.body.speed) : undefined);
    if (!message || typeof message !== "string" || !message.trim()) {
      throw AppError.validation("No message provided");
    }

    const llmResult = await withSessionLock(session.id, async () => {
      await addTurn(session.id, "user", message);
      const { systemPrompt, messages } = getMessagesForLLM(session.id);
      const result = await getLLMResponse(systemPrompt, messages);
      await addTurn(session.id, "assistant", result.text);
      return result;
    });

    const ttsResult = await synthesizeSpeech(llmResult.text, session.config.targetLanguage, voiceId, speed);

    res.json({
      transcript: message,
      text: llmResult.text,
      audioUrl: `/api/audio/${ttsResult.audioId}`,
      mimeType: ttsResult.mimeType,
      provider: { llm: llmResult.provider, tts: ttsResult.provider },
    });
  })
);

// ─── Delete session ───────────────────────────────────────────────────────────
router.delete(
  "/session/:id",
  asyncRoute(async (req, res) => {
    requireSession(req);
    await deleteSession(req.params.id);
    res.json({ ok: true });
  })
);

export default router;
