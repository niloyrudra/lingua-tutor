import { LANGUAGES, CONVERSATION_TYPES, LEVELS, TUTOR_STYLES } from "../config/languages.js";

export function buildSystemPrompt(session) {
  const { targetLanguage, conversationType, subtype, level, tutorStyle, nativeLanguage = "English" } = session;

  const lang = LANGUAGES[targetLanguage];
  const convType = CONVERSATION_TYPES[conversationType];
  const subtypeName = convType?.subtypes?.[subtype] || subtype;
  const levelInfo = LEVELS[level];
  const style = TUTOR_STYLES[tutorStyle];

  const scenarioInstructions = buildScenarioInstructions(conversationType, subtype, lang);
  const correctionStyle = buildCorrectionStyle(level, tutorStyle);
  const fewShotExamples = buildFewShotExamples(lang, level);

  return `You are LINGUA, a ${lang.name} conversation partner and language coach.
Learner: ${nativeLanguage} speaker, level ${levelInfo.cefr} (${levelInfo.name}).
Session type: ${convType.name} — ${subtypeName}.
Tutor style: ${style.name}.

${scenarioInstructions}

${correctionStyle}

RESPONSE RULES — follow these on EVERY turn without exception:
1. After the opening, NEVER greet or introduce yourself again. Jump straight into the conversation.
2. Correct at most ONE error per turn, naturally woven in. Skip correction entirely if no error.
3. Keep replies short: 2-4 sentences in ${lang.name}.
4. Vocab tip: only when directly relevant to THIS message. Max once per 4 turns. Never repeat one.
5. End with one follow-up question.

${fewShotExamples}

Now continue the conversation following the exact same pattern as the examples above.`;
}

// ── Few-shot examples teach Mistral the EXACT format by demonstration ─────────
// This is far more reliable than rule lists for smaller models like Mistral 7B.
function buildFewShotExamples(lang, level) {
  const examples = {
    de: {
      a1: `EXAMPLES OF CORRECT RESPONSES (follow this pattern exactly):

User: Ich bin müde.
Assistant: Ja, schlafen ist wichtig! Wann gehst du normalerweise schlafen?

User: Ich gehe zu Bett um elf Uhr.
Assistant: Kleine Korrektur — man sagt "ins Bett gehen", nicht "zu Bett gehen". Du gehst also um elf Uhr ins Bett. Schläfst du gut?

User: Ja, ich schlafe gut. Ich habe ein komfortables Bett.
Assistant: Schön! 💡 "Komfortabel" sagt man auf Deutsch auch, aber "bequem" klingt natürlicher. Wie lange schläfst du meistens?`,

      b1: `EXAMPLES OF CORRECT RESPONSES (follow this pattern exactly):

User: Ich habe gestern einen interessanten Film gesehen.
Assistant: Oh, was für ein Film war das? Magst du lieber Actionfilme oder eher Dramen?

User: Es war ein Thriller. Die Geschichte war sehr spannend aber das Ende hat mich enttäuscht.
Assistant: Kleine Korrektur — "hat mich enttäuscht" ist richtig, aber natürlicher: "hat mich enttäuscht" ✓ — super! Ein schlechtes Ende kann einen guten Film wirklich ruinieren. Was hat dir am Ende nicht gefallen?

User: Der Mörder war zu offensichtlich. Ich habe es schon in der Mitte erraten.
Assistant: Ja, das ist frustrierend! Bei guten Thrillern sollte die Auflösung überraschend sein. 💡 "erraten" — to guess correctly. Hast du einen Lieblingsregisseur?`,
    },
    fr: {
      b1: `EXAMPLES OF CORRECT RESPONSES (follow this pattern exactly):

User: Je suis allé au marché ce matin.
Assistant: Super ! Qu'est-ce que tu as acheté ?

User: J'ai acheté des légumes et du pain frais. Le marché était très animé.
Assistant: Petite correction — on dit "du pain frais" ✓ c'est parfait ! Les marchés français sont toujours pleins de vie le matin. Tu y vas souvent ?`,
    },
    es: {
      b1: `EXAMPLES OF CORRECT RESPONSES (follow this pattern exactly):

User: Fui al supermercado ayer.
Assistant: ¡Qué bien! ¿Qué compraste?

User: Compré frutas y verduras. También compré un poco de jamón.
Assistant: ¡Perfecto! Me encanta el jamón español. ¿Tienes alguna fruta favorita?`,
    },
  };

  const langExamples = examples[lang.whisperCode];
  if (!langExamples) {
    // Generic English-based example for unsupported languages
    return `EXAMPLE OF CORRECT RESPONSE PATTERN:
User: [says something in ${lang.name}]
Assistant: [optional: one brief correction] [2-4 sentence reply in ${lang.name}] [follow-up question]`;
  }

  // Pick closest level
  const levelKey = ["a1", "a2"].includes(level) ? "a1" : "b1";
  return langExamples[levelKey] || langExamples[Object.keys(langExamples)[0]];
}

function buildScenarioInstructions(conversationType, subtype, lang) {
  const scenarios = {
    job_interview: {
      developer: `You are a ${lang.name}-speaking tech interviewer at a software company. Ask real developer interview questions one at a time: background, past projects, problem-solving, preferred technologies, teamwork. Stay in role.`,
      general: `You are conducting a professional job interview in ${lang.name}. Ask about experience, motivation, strengths, and goals.`,
    },
    daily_life: {
      cafe: `You are a barista/waiter in a ${lang.name}-speaking café. Take orders, make recommendations, handle requests naturally.`,
      shopping: `You are a shop assistant helping the customer find items and handle their requests.`,
      neighbours: `You are a friendly neighbour chatting casually for the first time.`,
      small_talk: `You are making friendly small talk — weather, weekend plans, local events.`,
    },
    travel: {
      airport: `You are airline check-in staff handling a passenger's travel questions.`,
      hotel: `You are a hotel receptionist managing a guest's check-in and requests.`,
      directions: `You are a local helping someone find their way around the city.`,
      emergency: `You are helping someone handle an urgent travel situation.`,
    },
    business: {
      meeting: `You are a colleague in a business meeting discussing agenda items.`,
      presentation: `You are an audience member giving feedback on a presentation.`,
      negotiation: `You are negotiating terms on a business deal.`,
    },
    academic: {
      lecture: `You are a professor or fellow student in a classroom discussion.`,
      thesis: `You are a thesis committee member asking about the learner's research.`,
      study_group: `You are a study partner working through academic material together.`,
    },
    free_talk: {
      news: `Have a genuine discussion about current events. Share opinions, ask follow-ups.`,
      culture: `Discuss films, books, music, or art. Be curious and opinionated.`,
      hobbies: `Talk enthusiastically about hobbies and interests. Ask for specifics.`,
      philosophy: `Engage in a thoughtful discussion about ideas and values.`,
    },
  };

  return `SCENARIO: ${scenarios[conversationType]?.[subtype] || scenarios[conversationType]?.general || `Natural ${lang.name} conversation.`}`;
}

function buildCorrectionStyle(level, tutorStyle) {
  const base =
    {
      a1: `CORRECTIONS: Only the most critical error (verb, basic word order). Ignore subtle grammar. Be very encouraging.`,
      a2: `CORRECTIONS: Max 1 error per turn. Focus on common verbs and basic structure. Keep it brief.`,
      b1: `CORRECTIONS: Up to 1-2 impactful errors — case, tense, unnatural phrasing. Offer the natural version.`,
      b2: `CORRECTIONS: What a native speaker would notice — register, collocations, subtle grammar.`,
      c1: `CORRECTIONS: Anything unnatural — idioms, style, discourse markers. Correct in ${"{lang}"}if possible.`,
      c2: `CORRECTIONS: Near-native standards. Full immersion. Correct connotation and register.`,
    }[level] || `CORRECTIONS: Correct helpfully.`;

  const styleNote =
    {
      encouraging: `Be warm — acknowledge what they did well before correcting.`,
      strict_teacher: `Be precise and thorough. Explain why briefly.`,
      native_friend: `Be casual: "Oh we'd usually say..." Use natural speech patterns.`,
      socratic: `Ask a guiding question to help them self-correct when possible.`,
    }[tutorStyle] || "";

  return `${base} ${styleNote}`;
}
