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
};

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

    // Show session screen
    document.getElementById("setup-screen").classList.remove("active");
    document.getElementById("session-screen").style.display = "flex";

    buildSessionPanel();
    setupSessionControls();
    startTimer();

    // Get opening message
    showLoading("Your tutor is getting ready...");
    const startRes = await fetch(`/api/session/${state.session.sessionId}/start`, { method: "POST" });
    const startData = await startRes.json();

    hideLoading();
    appendMessage("tutor", startData.text);
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

    const res = await fetch(`/api/session/${state.session.sessionId}/speak`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (data.error) throw new Error(data.error);
    if (data.empty) return;

    if (data.transcript) {
      appendMessage("user", null, data.transcript);
    }

    appendMessage("tutor", data.text);
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
    const res = await fetch(`/api/session/${state.session.sessionId}/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    appendMessage("tutor", data.text);
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
function appendMessage(role, text, transcript = null) {
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
  const audio = new Audio(url);
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
