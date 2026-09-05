// ─── SUPPORTED LANGUAGES ────────────────────────────────────────────────────
export const LANGUAGES = {
  de: {
    name: "German",
    nativeName: "Deutsch",
    flag: "🇩🇪",
    whisperCode: "de",
    kokoroVoice: "bm_george", // German-accented voice fallback
  },
  fr: {
    name: "French",
    nativeName: "Français",
    flag: "🇫🇷",
    whisperCode: "fr",
    kokoroVoice: "bf_emma",
  },
  es: {
    name: "Spanish",
    nativeName: "Español",
    flag: "🇪🇸",
    whisperCode: "es",
    kokoroVoice: "af_heart",
  },
  it: {
    name: "Italian",
    nativeName: "Italiano",
    flag: "🇮🇹",
    whisperCode: "it",
    kokoroVoice: "af_bella",
  },
  pt: {
    name: "Portuguese",
    nativeName: "Português",
    flag: "🇵🇹",
    whisperCode: "pt",
    kokoroVoice: "af_heart",
  },
  nl: {
    name: "Dutch",
    nativeName: "Nederlands",
    flag: "🇳🇱",
    whisperCode: "nl",
    kokoroVoice: "bm_george",
  },
  ja: {
    name: "Japanese",
    nativeName: "日本語",
    flag: "🇯🇵",
    whisperCode: "ja",
    kokoroVoice: "af_heart",
  },
  zh: {
    name: "Mandarin",
    nativeName: "普通话",
    flag: "🇨🇳",
    whisperCode: "zh",
    kokoroVoice: "af_heart",
  },
};

// ─── CONVERSATION TYPES ──────────────────────────────────────────────────────
export const CONVERSATION_TYPES = {
  job_interview: {
    name: "Job Interview",
    icon: "💼",
    description: "Practice professional interviews in your target language",
    subtypes: {
      developer: "Software Developer Interview",
      designer: "Design / UX Interview",
      manager: "Management / Leadership Interview",
      sales: "Sales & Business Interview",
      general: "General Professional Interview",
    },
  },
  daily_life: {
    name: "Daily Life",
    icon: "☕",
    description: "Casual everyday conversations",
    subtypes: {
      cafe: "At a café or restaurant",
      shopping: "Shopping & errands",
      neighbours: "Meeting neighbours",
      small_talk: "Small talk & socialising",
    },
  },
  travel: {
    name: "Travel",
    icon: "✈️",
    description: "Navigate real travel situations",
    subtypes: {
      airport: "Airport & transport",
      hotel: "Hotel check-in / check-out",
      directions: "Asking for directions",
      emergency: "Emergency situations",
    },
  },
  business: {
    name: "Business",
    icon: "📊",
    description: "Professional business communication",
    subtypes: {
      meeting: "Business meetings",
      presentation: "Presentations & pitches",
      negotiation: "Negotiation & deals",
      email: "Discussing emails & reports",
    },
  },
  academic: {
    name: "Academic",
    icon: "🎓",
    description: "University and educational contexts",
    subtypes: {
      lecture: "Classroom discussion",
      thesis: "Thesis defence / viva",
      study_group: "Study group collaboration",
    },
  },
  free_talk: {
    name: "Free Talk",
    icon: "💬",
    description: "Open-ended conversation on any topic",
    subtypes: {
      news: "Current events & news",
      culture: "Culture, films, books",
      hobbies: "Hobbies & interests",
      philosophy: "Deep discussions",
    },
  },
};

// ─── PROFICIENCY LEVELS ──────────────────────────────────────────────────────
export const LEVELS = {
  a1: { name: "A1 – Beginner", cefr: "A1" },
  a2: { name: "A2 – Elementary", cefr: "A2" },
  b1: { name: "B1 – Intermediate", cefr: "B1" },
  b2: { name: "B2 – Upper Intermediate", cefr: "B2" },
  c1: { name: "C1 – Advanced", cefr: "C1" },
  c2: { name: "C2 – Mastery", cefr: "C2" },
};

// ─── TUTOR PERSONALITIES ─────────────────────────────────────────────────────
export const TUTOR_STYLES = {
  encouraging: {
    name: "Encouraging Coach",
    description: "Warm, patient, celebrates every win",
  },
  native_friend: {
    name: "Native Friend",
    description: "Casual, uses slang, feels like a real peer",
  },
  strict_teacher: {
    name: "Strict Teacher",
    description: "Corrects everything, high standards, thorough",
  },
  socratic: {
    name: "Socratic Guide",
    description: "Asks questions that lead you to figure it out yourself",
  },
};
