/* ── STATE ───────────────────────────────────────────────────────────────── */
const state = {
  config: null, // from /api/config
  session: null, // { sessionId, config }
  selection: {
    language: null,
    level: "b1",
    convType: null,
    subtype: null,
    tutorStyle: "encouraging",
  },
  recording: false,
  processing: false,
  mediaRecorder: null,
  audioChunks: [],
  sessionStartTime: null,
  timerInterval: null,
  turns: 0,
  // TTS settings
  ttsSettings: {
    voiceId: null,
    speed: 1.0,
    volume: 1.0,
  },
  availableVoices: [],
  audioContext: null,
  // Word translation popup
  wordCache: new Map(), // word -> { definitions, timestamp }
  wordPopup: null,
  wordPopupTarget: null,
};

/* ── WORD TRANSLATION POPUP ───────────────────────────────────────────────── */
const DICTIONARY_API = "/api/dictionary/";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

async function fetchWordDefinition(word) {
  const lang = state.session?.config?.targetLanguage || "en";
  const cacheKey = `${lang}:${word}`;
  const cached = state.wordCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.definitions;
  }
  try {
    const res = await fetch(`${DICTIONARY_API}${encodeURIComponent(word)}?lang=${lang}`);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.definitions || [];
    state.wordCache.set(cacheKey, { definitions: result, timestamp: Date.now() });
    return result;
  } catch (e) {
    console.warn("Dictionary fetch failed:", e);
    return null;
  }
}

function showWordPopup(wordEl, word) {
  hideWordPopup();
  const rect = wordEl.getBoundingClientRect();
  const popup = document.createElement("div");
  popup.className = "word-popup";
  popup.innerHTML = `<div class="word-popup-loading">Loading…</div>`;
  document.body.appendChild(popup);

  // Position popup above the word, flip if near top
  const popupRect = popup.getBoundingClientRect();
  let top = rect.top - popupRect.height - 8;
  let left = rect.left + (rect.width - popupRect.width) / 2;
  if (top < 8) top = rect.bottom + 8;
  if (left < 8) left = 8;
  if (left + popupRect.width > window.innerWidth - 8) {
    left = window.innerWidth - popupRect.width - 8;
  }
  popup.style.top = `${top + window.scrollY}px`;
  popup.style.left = `${left + window.scrollX}px`;

  state.wordPopup = popup;
  state.wordPopupTarget = wordEl;
  wordEl.classList.add("word-popup-active");

  fetchWordDefinition(word).then(defs => {
    if (!state.wordPopup || state.wordPopupTarget !== wordEl) return; // closed/moved
    if (!defs || defs.length === 0) {
      popup.innerHTML = `<div class="word-popup-empty">No definition found</div>`;
      return;
    }
    popup.innerHTML = `
      <div class="word-popup-header">${word}</div>
      <ul class="word-popup-defs">
        ${defs.map(d => `<li><span class="word-popup-pos">${d.pos}</span> ${d.def}</li>`).join("")}
      </ul>
    `;
    // Reposition after content loads
    const newRect = popup.getBoundingClientRect();
    let newTop = rect.top - newRect.height - 8;
    let newLeft = rect.left + (rect.width - newRect.width) / 2;
    if (newTop < 8) newTop = rect.bottom + 8;
    if (newLeft < 8) newLeft = 8;
    if (newLeft + newRect.width > window.innerWidth - 8) {
      newLeft = window.innerWidth - newRect.width - 8;
    }
    popup.style.top = `${newTop + window.scrollY}px`;
    popup.style.left = `${newLeft + window.scrollX}px`;
  });
}

function hideWordPopup() {
  if (state.wordPopup) {
    state.wordPopup.remove();
    state.wordPopup = null;
  }
  if (state.wordPopupTarget) {
    state.wordPopupTarget.classList.remove("word-popup-active");
    state.wordPopupTarget = null;
  }
}

function setupWordPopupHandlers() {
  const chatLog = document.getElementById("chat-log");
  let touchTimer = null;
  let touchStartEl = null;

  // Click / tap on word token
  chatLog.addEventListener("click", e => {
    const wordEl = e.target.closest(".word-token");
    if (!wordEl) return;
    e.preventDefault();
    e.stopPropagation();
    const word = wordEl.dataset.word;
    if (word) showWordPopup(wordEl, word);
  });

  // Touch handling: tap to show, long-press not needed per requirements
  chatLog.addEventListener("touchstart", e => {
    const wordEl = e.target.closest(".word-token");
    if (!wordEl) return;
    touchStartEl = wordEl;
    touchTimer = setTimeout(() => {
      touchStartEl = null;
    }, 500);
  }, { passive: true });

  chatLog.addEventListener("touchend", e => {
    if (touchTimer) {
      clearTimeout(touchTimer);
      const wordEl = e.target.closest(".word-token");
      if (wordEl && wordEl === touchStartEl) {
        e.preventDefault();
        const word = wordEl.dataset.word;
        if (word) showWordPopup(wordEl, word);
      }
      touchStartEl = null;
    }
  });

  // Hover on desktop: show after brief delay
  let hoverTimer = null;
  chatLog.addEventListener("mouseover", e => {
    const wordEl = e.target.closest(".word-token");
    if (!wordEl) return;
    hoverTimer = setTimeout(() => {
      const word = wordEl.dataset.word;
      if (word) showWordPopup(wordEl, word);
    }, 200);
  });

  chatLog.addEventListener("mouseout", e => {
    const wordEl = e.target.closest(".word-token");
    if (!wordEl || wordEl !== state.wordPopupTarget) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    // Don't hide immediately; let user move mouse to popup
  });

  // Click outside to close
  document.addEventListener("click", e => {
    if (state.wordPopup && !state.wordPopup.contains(e.target) && !e.target.closest(".word-token")) {
      hideWordPopup();
    }
  });

  // Scroll/resize: reposition or close
  window.addEventListener("scroll", hideWordPopup, { passive: true });
  window.addEventListener("resize", hideWordPopup);
}

/* ── INIT ────────────────────────────────────────────────────────────────── */
async function init() {
  try {
    const res = await fetch("/api/config");
    state.config = await res.json();
    buildSetupUI();
  } catch (e) {
    alert("Could not connect to server. Make sure the backend is running on port 3000.");
    console.error(e);
  }
}

/* ── BUILD SETUP UI ──────────────────────────────────────────────────────── */
function buildSetupUI() {
  const { languages, conversationTypes, levels, tutorStyles } = state.config;

  // Languages
  buildGrid("language-grid", Object.entries(languages), ([code, lang]) => ({
    key: code,
    html: `<span class="flag">${lang.flag}</span> ${lang.nativeName}`,
    group: "language",
  }));

  // Levels
  buildGrid("level-grid", Object.entries(levels), ([code, lvl]) => ({
    key: code,
    html: lvl.name,
    group: "level",
    selected: code === "b1",
  }));

  // Conversation types
  buildGrid("conv-type-grid", Object.entries(conversationTypes), ([code, conv]) => ({
    key: code,
    html: `<span class="icon">${conv.icon}</span> ${conv.name}`,
    group: "convType",
  }));

  // Tutor styles
  buildGrid("style-grid", Object.entries(tutorStyles), ([code, style]) => ({
    key: code,
    html: `<strong>${style.name}</strong> — <span style="color:var(--text-faint);font-size:0.8rem">${style.description}</span>`,
    group: "tutorStyle",
    selected: code === "encouraging",
  }));

  // Apply pre-selected defaults
  document.querySelectorAll('.option-btn[data-selected="true"]').forEach(btn => {
    btn.classList.add("selected");
  });

  document.getElementById("start-btn").addEventListener("click", startSession);
}

function buildGrid(containerId, entries, mapper) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  entries.forEach(entry => {
    const { key, html, group, selected } = mapper(entry);
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.innerHTML = html;
    btn.dataset.key = key;
    btn.dataset.group = group;
    if (selected) btn.dataset.selected = "true";

    btn.addEventListener("click", () => handleOptionSelect(btn, group, key));
    container.appendChild(btn);
  });
}

function handleOptionSelect(btn, group, key) {
  // Deselect siblings
  const container = btn.closest(".option-grid");
  container.querySelectorAll(".option-btn").forEach(b => b.classList.remove("selected"));
  btn.classList.add("selected");

  // Store selection
  state.selection[group] = key;

  // Handle conversation subtype
  if (group === "convType") {
    buildSubtypeGrid(key);
  }

  validateForm();
}

function buildSubtypeGrid(convType) {
  const convTypes = state.config.conversationTypes;
  const subtypes = convTypes[convType]?.subtypes;
  const group = document.getElementById("subtype-group");

  if (!subtypes || Object.keys(subtypes).length === 0) {
    group.style.display = "none";
    state.selection.subtype = "general";
    return;
  }

  group.style.display = "block";
  buildGrid("subtype-grid", Object.entries(subtypes), ([code, name]) => ({
    key: code,
    html: name,
    group: "subtype",
  }));
  state.selection.subtype = null;
  validateForm();
}

function validateForm() {
  const { language, convType, subtype } = state.selection;
  const subtypeGroup = document.getElementById("subtype-group");
  const subtypeRequired = subtypeGroup.style.display !== "none";
  const ready = language && convType && (!subtypeRequired || subtype);
  document.getElementById("start-btn").disabled = !ready;
}

/* ── START SESSION ───────────────────────────────────────────────────────── */
async function startSession() {
  showLoading("Setting up your tutor...");

  try {
    // Create session
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetLanguage: state.selection.language,
        conversationType: state.selection.convType,
        subtype: state.selection.subtype || "general",
        level: state.selection.level,
        tutorStyle: state.selection.tutorStyle,
      }),
    });

    state.session = await res.json();

    // Fetch available voices for the session language
    try {
      const voicesRes = await fetch(`/api/voices?language=${state.session.config.targetLanguage}`);
      const voicesData = await voicesRes.json();
      state.availableVoices = voicesData.voices || [];
      
      // Load saved TTS settings or use defaults
      const savedSettings = localStorage.getItem(`ttsSettings_${state.session.config.targetLanguage}`);
      if (savedSettings) {
        state.ttsSettings = { ...state.ttsSettings, ...JSON.parse(savedSettings) };
      }
      
      // Set default voice if not set (prefer female for variety, or first available)
      if (!state.ttsSettings.voiceId && state.availableVoices.length > 0) {
        const femaleVoice = state.availableVoices.find(v => v.gender === "female");
        state.ttsSettings.voiceId = (femaleVoice || state.availableVoices[0]).id;
      }
    } catch (e) {
      console.warn("Failed to fetch voices:", e);
    }

    // Initialize Web Audio API for volume control
    try {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("Web Audio API not available:", e);
    }

    // Show session screen
    document.getElementById("setup-screen").classList.remove("active");
    document.getElementById("session-screen").style.display = "flex";

    buildSessionPanel();
    setupSessionControls();
    setupWordPopupHandlers();
    startTimer();

    // Get opening message
    showLoading("Your tutor is getting ready...");
    const params = new URLSearchParams();
    if (state.ttsSettings.voiceId) params.set("voice", state.ttsSettings.voiceId);
    if (state.ttsSettings.speed !== 1.0) params.set("speed", state.ttsSettings.speed.toFixed(1));
    const queryString = params.toString() ? `?${params.toString()}` : "";
    const startRes = await fetch(`/api/session/${state.session.sessionId}/start${queryString}`, { method: "POST" });
    const startData = await startRes.json();

    hideLoading();
    appendMessage("tutor", startData.text, null, startData.audioUrl);
    playAudio(startData.audioUrl);
  } catch (e) {
    hideLoading();
    console.error("Session start failed:", e);
    alert("Failed to start session: " + e.message);
  }
}

/* ── SESSION PANEL ───────────────────────────────────────────────────────── */
function buildSessionPanel() {
  const { config } = state.session;
  const langs = state.config.languages;
  const convTypes = state.config.conversationTypes;
  const levels = state.config.levels;

  const lang = langs[config.targetLanguage];
  const conv = convTypes[config.conversationType];
  const level = levels[config.level];

  document.getElementById("session-info-panel").innerHTML = `
    <div class="session-badge">
      <span class="badge-icon">${lang.flag}</span>
      <strong>${lang.name}</strong>
    </div>
    <div class="session-badge">
      <span class="badge-icon">${conv.icon}</span>
      <strong>${conv.name}</strong>
    </div>
    <div class="session-badge">
      <span class="badge-icon">📊</span>
      <strong>${level.name}</strong>
    </div>
  `;
}

/* ── CONTROLS ────────────────────────────────────────────────────────────── */
function setupSessionControls() {
  const micBtn = document.getElementById("mic-btn");
  const textModeBtn = document.getElementById("text-mode-btn");
  const endBtn = document.getElementById("end-session-btn");
  const textSendBtn = document.getElementById("text-send-btn");
  const textInput = document.getElementById("text-input");
  const voiceSettingsBtn = document.getElementById("voice-settings-btn");

  // Mic: press-and-hold
  micBtn.addEventListener("mousedown", startRecording);
  micBtn.addEventListener("touchstart", e => {
    e.preventDefault();
    startRecording();
  });
  micBtn.addEventListener("mouseup", stopRecording);
  micBtn.addEventListener("mouseleave", stopRecording);
  micBtn.addEventListener("touchend", stopRecording);

  // Toggle text mode
  textModeBtn.addEventListener("click", () => {
    const micArea = document.getElementById("mic-area");
    const textArea = document.getElementById("text-input-area");
    const isTextMode = textArea.style.display !== "none";

    micArea.style.display = isTextMode ? "flex" : "none";
    textArea.style.display = isTextMode ? "none" : "flex";
    textModeBtn.textContent = isTextMode ? "⌨️ Type mode" : "🎙️ Mic mode";
  });

  // Voice settings modal
  if (voiceSettingsBtn) {
    voiceSettingsBtn.addEventListener("click", openVoiceSettings);
  }

  // Text send
  textSendBtn.addEventListener("click", sendTextMessage);
  textInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendTextMessage();
    }
  });

  // End session
  endBtn.addEventListener("click", () => {
    if (confirm("End this session?")) endSession();
  });
}

/* ── VOICE SETTINGS ───────────────────────────────────────────────────────── */
function openVoiceSettings() {
  if (state.availableVoices.length === 0) {
    alert("No voices available for this language.");
    return;
  }

  // Create modal
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>🎤 Voice Settings</h3>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">
        <div class="setting-group">
          <label>Voice</label>
          <select id="voice-select">
            ${state.availableVoices.map(v => 
              `<option value="${v.id}" ${v.id === state.ttsSettings.voiceId ? "selected" : ""}>
                ${v.name} (${v.gender}, ${v.engine}${v.quality ? ", " + v.quality : ""})
              </option>`
            ).join("")}
          </select>
        </div>
        <div class="setting-group">
          <label>Speed: <span id="speed-value">${state.ttsSettings.speed.toFixed(1)}</span>×</label>
          <input type="range" id="speed-slider" min="0.5" max="2.0" step="0.1" value="${state.ttsSettings.speed}">
        </div>
        <div class="setting-group">
          <label>Volume: <span id="volume-value">${Math.round(state.ttsSettings.volume * 100)}%</span></label>
          <input type="range" id="volume-slider" min="0" max="1" step="0.05" value="${state.ttsSettings.volume}">
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" id="voice-save-btn">Save</button>
          <button class="btn-ghost" id="voice-cancel-btn">Cancel</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Event listeners
  const voiceSelect = modal.querySelector("#voice-select");
  const speedSlider = modal.querySelector("#speed-slider");
  const volumeSlider = modal.querySelector("#volume-slider");
  const speedValue = modal.querySelector("#speed-value");
  const volumeValue = modal.querySelector("#volume-value");
  const saveBtn = modal.querySelector("#voice-save-btn");
  const cancelBtn = modal.querySelector("#voice-cancel-btn");
  const closeBtn = modal.querySelector(".modal-close");

  speedSlider.addEventListener("input", e => {
    speedValue.textContent = parseFloat(e.target.value).toFixed(1) + "×";
  });

  volumeSlider.addEventListener("input", e => {
    volumeValue.textContent = Math.round(e.target.value * 100) + "%";
  });

  const closeModal = () => modal.remove();

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", e => {
    if (e.target === modal) closeModal();
  });

  saveBtn.addEventListener("click", () => {
    state.ttsSettings.voiceId = voiceSelect.value;
    state.ttsSettings.speed = parseFloat(speedSlider.value);
    state.ttsSettings.volume = parseFloat(volumeSlider.value);

    // Persist settings
    const lang = state.session?.config?.targetLanguage || "de";
    localStorage.setItem(`ttsSettings_${lang}`, JSON.stringify(state.ttsSettings));

    closeModal();
  });
}

/* ── AUDIO RECORDING ─────────────────────────────────────────────────────── */
async function startRecording() {
  if (state.recording || state.processing) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    state.mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });

    state.mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    };

    state.mediaRecorder.start(250); // collect every 250ms
    state.recording = true;

    const micBtn = document.getElementById("mic-btn");
    micBtn.classList.add("recording");
    document.getElementById("mic-status").textContent = "Recording...";
    document.getElementById("mic-hint").textContent = "Release to send";

    // Pulse timer
    let secs = 0;
    state._recInterval = setInterval(() => {
      secs++;
      document.getElementById("mic-status").textContent = `Recording ${secs}s`;
    }, 1000);
  } catch (e) {
    console.error("Mic access denied:", e);
    alert("Microphone access is required. Please allow mic access and try again.");
  }
}

async function stopRecording() {
  if (!state.recording) return;
  state.recording = false;
  clearInterval(state._recInterval);

  const micBtn = document.getElementById("mic-btn");
  micBtn.classList.remove("recording");
  micBtn.classList.add("processing");
  document.getElementById("mic-status").textContent = "Processing...";
  document.getElementById("mic-hint").textContent = "Please wait...";

  state.mediaRecorder.stop();
  state.mediaRecorder.stream.getTracks().forEach(t => t.stop());

  await new Promise(resolve => {
    state.mediaRecorder.onstop = resolve;
  });

  const blob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType });
  await processAudio(blob);

  micBtn.classList.remove("processing");
  document.getElementById("mic-status").textContent = "Ready";
  document.getElementById("mic-hint").textContent = "Press and hold to speak";
}

async function processAudio(blob) {
  if (blob.size < 1000) {
    console.warn("Audio too short, skipping");
    return;
  }

  state.processing = true;

  try {
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");

    const params = new URLSearchParams();
    if (state.ttsSettings.voiceId) params.set("voice", state.ttsSettings.voiceId);
    if (state.ttsSettings.speed !== 1.0) params.set("speed", state.ttsSettings.speed.toFixed(1));
    const queryString = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`/api/session/${state.session.sessionId}/speak${queryString}`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (data.error) throw new Error(data.error);
    if (data.empty) return;

    if (data.transcript) {
      appendMessage("user", null, data.transcript);
    }

    appendMessage("tutor", data.text, null, data.audioUrl);
    playAudio(data.audioUrl);

    state.turns++;
    document.getElementById("stat-turns").textContent = state.turns;
  } catch (e) {
    console.error("Pipeline error:", e);
    appendMessage("tutor", `⚠️ Something went wrong: ${e.message}. Please try again.`);
  } finally {
    state.processing = false;
  }
}

/* ── TEXT MESSAGE ────────────────────────────────────────────────────────── */
async function sendTextMessage() {
  const input = document.getElementById("text-input");
  const message = input.value.trim();
  if (!message || state.processing) return;

  input.value = "";
  state.processing = true;
  appendMessage("user", null, message);

  try {
    const params = new URLSearchParams();
    if (state.ttsSettings.voiceId) params.set("voice", state.ttsSettings.voiceId);
    if (state.ttsSettings.speed !== 1.0) params.set("speed", state.ttsSettings.speed.toFixed(1));
    const queryString = params.toString() ? `?${params.toString()}` : "";
    const res = await fetch(`/api/session/${state.session.sessionId}/text${queryString}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    appendMessage("tutor", data.text, null, data.audioUrl);
    playAudio(data.audioUrl);

    state.turns++;
    document.getElementById("stat-turns").textContent = state.turns;
  } catch (e) {
    appendMessage("tutor", `⚠️ Error: ${e.message}`);
  } finally {
    state.processing = false;
  }
}

/* ── CHAT MESSAGES ───────────────────────────────────────────────────────── */
function appendMessage(role, text, transcript = null, audioUrl = null) {
  const chat = document.getElementById("chat-log");

  // Remove empty state
  const emptyState = chat.querySelector(".empty-chat");
  if (emptyState) emptyState.remove();

  const msg = document.createElement("div");
  msg.className = `msg msg-${role}`;

  if (role === "user") {
    if (transcript) {
      const label = document.createElement("div");
      label.className = "transcript-label";
      label.textContent = `🎙 ${transcript}`;
      msg.appendChild(label);
    }
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.textContent = transcript || text || "";
    msg.appendChild(bubble);
  } else {
    // Tutor output is untrusted (LLM) — render it via the safe renderer only.
    const { main, vocab } = window.extractVocabTip(text);
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.appendChild(window.renderMarkdown(main));
    if (vocab) {
      const tip = document.createElement("div");
      tip.className = "vocab-tip";
      tip.textContent = vocab;
      bubble.appendChild(tip);
    }
    msg.appendChild(bubble);

    // Add replay button for tutor messages if audioUrl is available
    if (audioUrl) {
      const controls = document.createElement("div");
      controls.className = "msg-controls";
      
      const replayBtn = document.createElement("button");
      replayBtn.className = "replay-btn";
      replayBtn.innerHTML = "🔊";
      replayBtn.title = "Replay audio";
      replayBtn.setAttribute("aria-label", "Replay audio");
      replayBtn.addEventListener("click", () => playAudio(audioUrl));
      controls.appendChild(replayBtn);
      
      msg.appendChild(controls);
    }
  }

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = formatTime();
  msg.appendChild(meta);

  chat.appendChild(msg);
  chat.scrollTop = chat.scrollHeight;

  // Bound the DOM — prune the oldest messages past 300 entries.
  while (chat.children.length > 300) chat.removeChild(chat.firstChild);
}

/* ── AUDIO PLAYBACK ──────────────────────────────────────────────────────── */
function playAudio(url) {
  if (!url) return;
  
  // Use Web Audio API for volume control if available
  if (state.audioContext) {
    fetch(url)
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => state.audioContext.decodeAudioData(arrayBuffer))
      .then(audioBuffer => {
        const source = state.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        
        const gainNode = state.audioContext.createGain();
        gainNode.gain.value = state.ttsSettings.volume;
        
        source.connect(gainNode);
        gainNode.connect(state.audioContext.destination);
        source.start(0);
      })
      .catch(e => {
        console.warn("Web Audio playback failed, falling back to HTMLAudioElement:", e);
        fallbackPlayAudio(url);
      });
  } else {
    fallbackPlayAudio(url);
  }
}

function fallbackPlayAudio(url) {
  const audio = new Audio(url);
  audio.volume = state.ttsSettings.volume;
  audio.preload = "auto";
  audio.play().catch(e => console.warn("Audio play failed:", e));
}

/* ── TIMER ───────────────────────────────────────────────────────────────── */
function startTimer() {
  state.sessionStartTime = Date.now();
  state.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - state.sessionStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    document.getElementById("stat-time").textContent = `${m}:${s.toString().padStart(2, "0")}`;
  }, 1000);
}

/* ── END SESSION ─────────────────────────────────────────────────────────── */
async function endSession() {
  clearInterval(state.timerInterval);
  await fetch(`/api/session/${state.session.sessionId}`, { method: "DELETE" }).catch(() => {});

  document.getElementById("session-screen").style.display = "none";
  document.getElementById("setup-screen").classList.add("active");
  document.getElementById("chat-log").innerHTML = "";
  state.session = null;
  state.turns = 0;
}

/* ── HELPERS ─────────────────────────────────────────────────────────────── */
function showLoading(text = "Loading...") {
  document.getElementById("loading-text").textContent = text;
  document.getElementById("loading-overlay").style.display = "flex";
}

function hideLoading() {
  document.getElementById("loading-overlay").style.display = "none";
}

function formatTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getSupportedMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || "";
}

/* ── BOOT ────────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", init);
