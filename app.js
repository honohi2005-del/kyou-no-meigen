const $ = (id) => document.getElementById(id);

const els = {
  quoteNumber: $("quote-number"),
  quoteCategory: $("quote-category"),
  quoteText: $("quote-text"),
  quoteAuthor: $("quote-author"),
  quoteSource: $("quote-source"),
  quoteAudio: $("quote-audio"),
  playQuote: $("play-quote"),
  audioStatus: $("audio-status"),
  recordButton: $("record-button"),
  recordButtonLabel: $("record-button-label"),
  recordingTime: $("recording-time"),
  recordingStatus: $("recording-status"),
  studentAudio: $("student-audio"),
  recordingActions: $("recording-actions"),
  deleteRecording: $("delete-recording"),
  quoteSearch: $("quote-search"),
  quoteList: $("quote-list"),
  quoteCount: $("quote-count"),
};

const state = {
  quotes: [],
  currentQuote: null,
  audioManifest: new Set(),
  db: null,
  recorder: null,
  mediaStream: null,
  recordingChunks: [],
  recordingStartedAt: 0,
  recordingTimer: null,
  activeRecordingKey: null,
  studentObjectUrl: null,
};

const DB_NAME = "kyou-no-meigen-recordings";
const DB_VERSION = 1;
const RECORDINGS_STORE = "recordings";
const TOKYO_TIME_ZONE = "Asia/Tokyo";

function plainText(rubyText) {
  return rubyText.replace(/\[[^\]]+\]/g, "");
}

function renderRuby(element, rubyText) {
  element.replaceChildren();
  const pattern = /(\p{Script=Han})(?:\[([^\]]+)\])?/gu;
  let cursor = 0;
  let match;

  while ((match = pattern.exec(rubyText)) !== null) {
    if (match.index > cursor) {
      element.append(document.createTextNode(rubyText.slice(cursor, match.index)));
    }

    if (match[2]) {
      const ruby = document.createElement("ruby");
      ruby.append(document.createTextNode(match[1]));
      const rt = document.createElement("rt");
      rt.textContent = match[2];
      ruby.append(rt);
      element.append(ruby);
    } else {
      element.append(document.createTextNode(match[1]));
    }
    cursor = pattern.lastIndex;
  }

  if (cursor < rubyText.length) {
    element.append(document.createTextNode(rubyText.slice(cursor)));
  }
}

function getTokyoDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TOKYO_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function getTokyoDateKey(date = new Date()) {
  const parts = getTokyoDateParts(date);
  return parts.year + "-" + String(parts.month).padStart(2, "0") + "-" + String(parts.day).padStart(2, "0");
}

function getTokyoDayOfYear(date = new Date()) {
  const parts = getTokyoDateParts(date);
  const current = Date.UTC(parts.year, parts.month - 1, parts.day);
  const first = Date.UTC(parts.year, 0, 1);
  return Math.floor((current - first) / 86400000) + 1;
}

function currentRecordingKey() {
  return state.currentQuote ? getTokyoDateKey() + ":" + state.currentQuote.id : null;
}

function setStatus(message, kind = "") {
  els.recordingStatus.textContent = message;
  els.recordingStatus.dataset.kind = kind;
}

function setAudioButton(isPlaying = false) {
  const icon = els.playQuote.querySelector(".button-icon");
  if (icon) icon.textContent = isPlaying ? "Ⅱ" : "▶";
  const label = els.playQuote.querySelector("span:last-child");
  if (label) label.textContent = isPlaying ? "停止する" : "音声を聴く";
}

function updateAudioAvailability() {
  const quote = state.currentQuote;
  const available = Boolean(quote) &&
    (state.audioManifest.size === 0 || state.audioManifest.has(quote.id));
  els.playQuote.disabled = !available;
  els.audioStatus.textContent = available ? "Google Cloud Text-to-Speech" : "お手本音声は準備中です";
}

function renderCurrentQuote() {
  const quote = state.currentQuote;
  if (!quote) return;

  els.quoteNumber.textContent = "NO. " + String(state.quotes.indexOf(quote) + 1).padStart(2, "0");
  els.quoteCategory.textContent = quote.category;
  renderRuby(els.quoteText, quote.ruby);
  els.quoteAuthor.textContent = quote.author;
  els.quoteSource.textContent = "典拠：" + quote.source;

  if (quote.sourceUrl) {
    els.quoteSource.href = quote.sourceUrl;
    els.quoteSource.removeAttribute("aria-disabled");
  } else {
    els.quoteSource.removeAttribute("href");
    els.quoteSource.setAttribute("aria-disabled", "true");
  }

  els.quoteAudio.src = "./audio/" + encodeURIComponent(quote.id) + ".mp3";
  els.quoteAudio.load();
  setAudioButton(false);
  updateAudioAvailability();
  loadStudentRecording().catch(() => {
    setStatus("保存済み録音を読み込めませんでした", "error");
  });
}

function renderQuoteList(query = "") {
  const normalized = query.trim().toLocaleLowerCase("ja-JP");
  const filtered = state.quotes.filter((quote) => {
    if (!normalized) return true;
    const searchable = (quote.text + " " + quote.author + " " + quote.source + " " + quote.category).toLocaleLowerCase("ja-JP");
    return searchable.includes(normalized);
  });

  els.quoteList.replaceChildren();
  if (filtered.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "見つかりませんでした。別の言葉で検索してください。";
    els.quoteList.append(empty);
    els.quoteCount.textContent = "0件";
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const quote of filtered) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quote-list-item";
    button.dataset.quoteId = quote.id;
    if (state.currentQuote?.id === quote.id) button.classList.add("is-selected");

    const text = document.createElement("span");
    text.className = "quote-list-text";
    renderRuby(text, quote.ruby);

    const meta = document.createElement("span");
    meta.className = "quote-list-meta";
    meta.textContent = quote.author + " · " + quote.source;

    button.append(text, meta);
    fragment.append(button);
  }
  els.quoteList.append(fragment);
  els.quoteCount.textContent = normalized ? filtered.length + " / " + state.quotes.length + "件" : state.quotes.length + "件";
}

function selectQuote(id, updateUrl = true) {
  const quote = state.quotes.find((item) => item.id === id);
  if (!quote) return;

  if (state.recorder?.state === "recording") {
    state.recorder.stop();
  }

  state.currentQuote = quote;
  if (updateUrl) {
    history.replaceState(null, "", "#" + encodeURIComponent(quote.id));
  }
  renderCurrentQuote();
  renderQuoteList(els.quoteSearch.value);
}

function chooseDailyQuote() {
  if (state.quotes.length === 0) return null;
  let hashId = "";
  try {
    hashId = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  } catch {
    hashId = "";
  }
  const fromHash = state.quotes.find((quote) => quote.id === hashId);
  if (fromHash) return fromHash;
  return state.quotes[(getTokyoDayOfYear() - 1) % state.quotes.length];
}

async function loadAudioManifest() {
  try {
    const response = await fetch("./audio/manifest.json", { cache: "no-store" });
    if (!response.ok) return;
    const manifest = await response.json();
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    state.audioManifest = new Set(files.map((file) => file.id));
    updateAudioAvailability();
  } catch {
    // A missing manifest should not prevent the HTML audio element from working.
  }
}

function openDatabase() {
  if (state.db) return Promise.resolve(state.db);
  if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is unavailable"));

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RECORDINGS_STORE)) {
        database.createObjectStore(RECORDINGS_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      state.db = request.result;
      resolve(state.db);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getRecording(key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(RECORDINGS_STORE, "readonly");
    const request = transaction.objectStore(RECORDINGS_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function saveRecording(recording) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(RECORDINGS_STORE, "readwrite");
    transaction.objectStore(RECORDINGS_STORE).put(recording);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function removeRecording(key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(RECORDINGS_STORE, "readwrite");
    transaction.objectStore(RECORDINGS_STORE).delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function clearStudentAudio() {
  if (state.studentObjectUrl) {
    URL.revokeObjectURL(state.studentObjectUrl);
    state.studentObjectUrl = null;
  }
  els.studentAudio.removeAttribute("src");
  els.studentAudio.hidden = true;
  els.recordingActions.hidden = true;
}

async function loadStudentRecording() {
  clearStudentAudio();
  const key = currentRecordingKey();
  if (!key) return;

  try {
    const recording = await getRecording(key);
    if (!recording || state.currentQuote?.id !== key.split(":").at(-1)) {
      setStatus("準備完了");
      return;
    }
    state.studentObjectUrl = URL.createObjectURL(recording.blob);
    els.studentAudio.src = state.studentObjectUrl;
    els.studentAudio.hidden = false;
    els.recordingActions.hidden = false;
    els.recordingTime.textContent = formatDuration(recording.durationMs ?? 0);
    setStatus("保存済み");
  } catch {
    setStatus("録音保存はこのブラウザでは利用できません", "error");
  }
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}

function updateRecordingTimer() {
  els.recordingTime.textContent = formatDuration(Date.now() - state.recordingStartedAt);
}

function chooseRecordingMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus("このブラウザは録音に対応していません", "error");
    return;
  }

  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = chooseRecordingMimeType();
    state.recorder = mimeType ? new MediaRecorder(state.mediaStream, { mimeType }) : new MediaRecorder(state.mediaStream);
    state.recordingChunks = [];
    state.activeRecordingKey = currentRecordingKey();
    state.recordingStartedAt = Date.now();
    state.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) state.recordingChunks.push(event.data);
    };
    state.recorder.onstop = finishRecording;
    state.recorder.start();
    state.recordingTimer = window.setInterval(updateRecordingTimer, 250);
    els.recordButton.classList.add("is-recording");
    els.recordButtonLabel.textContent = "録音を止める";
    setStatus("録音中", "recording");
    updateRecordingTimer();
  } catch (error) {
    state.mediaStream?.getTracks().forEach((track) => track.stop());
    state.mediaStream = null;
    const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
    setStatus(denied ? "マイクの使用を許可してください" : "マイクを開始できませんでした", "error");
  }
}

async function finishRecording() {
  window.clearInterval(state.recordingTimer);
  state.recordingTimer = null;
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  state.mediaStream = null;

  const durationMs = Date.now() - state.recordingStartedAt;
  const mimeType = state.recordingChunks[0]?.type || "audio/webm";
  const blob = new Blob(state.recordingChunks, { type: mimeType });
  const key = state.activeRecordingKey;
  state.recordingChunks = [];
  state.activeRecordingKey = null;
  els.recordButton.classList.remove("is-recording");
  els.recordButtonLabel.textContent = "録音を始める";
  els.recordingTime.textContent = formatDuration(durationMs);
  setStatus("保存中");

  if (!key || blob.size === 0) {
    setStatus("録音データがありません", "error");
    return;
  }

  try {
    await saveRecording({
      key,
      blob,
      mimeType,
      durationMs,
      savedAt: new Date().toISOString(),
    });
    if (state.currentQuote && key.endsWith(":" + state.currentQuote.id)) {
      await loadStudentRecording();
    }
  } catch {
    setStatus("録音を保存できませんでした", "error");
  }
}

async function toggleRecording() {
  if (state.recorder?.state === "recording") {
    state.recorder.stop();
    return;
  }
  await startRecording();
}

async function deleteCurrentRecording() {
  const key = currentRecordingKey();
  if (!key) return;
  try {
    await removeRecording(key);
    clearStudentAudio();
    els.recordingTime.textContent = "00:00";
    setStatus("削除しました");
  } catch {
    setStatus("録音を削除できませんでした", "error");
  }
}

function showAppError(message) {
  els.quoteCategory.textContent = "読み込みエラー";
  els.quoteText.textContent = message;
  els.quoteAuthor.textContent = "";
  els.quoteSource.textContent = "";
  els.playQuote.disabled = true;
  els.recordButton.disabled = true;
  els.quoteList.replaceChildren();
}

async function init() {
  try {
    const response = await fetch("./data/quotes.json");
    if (!response.ok) throw new Error("HTTP " + response.status);
    const rawQuotes = await response.json();
    if (!Array.isArray(rawQuotes) || rawQuotes.length === 0) throw new Error("No quotes");

    state.quotes = rawQuotes.map((quote) => ({
      ...quote,
      text: plainText(quote.ruby),
    }));
    els.quoteCount.textContent = state.quotes.length + "件";
    state.currentQuote = chooseDailyQuote();
    renderCurrentQuote();
    renderQuoteList();
    els.recordButton.disabled = false;
    await Promise.allSettled([loadAudioManifest(), loadStudentRecording()]);
  } catch (error) {
    console.error("quote data load failed", error);
    showAppError("名言データを読み込めませんでした。ページを再読み込みしてください。");
  }
}

els.playQuote.addEventListener("click", async () => {
  if (els.quoteAudio.paused) {
    try {
      await els.quoteAudio.play();
    } catch {
      els.audioStatus.textContent = "音声を再生できませんでした";
    }
  } else {
    els.quoteAudio.pause();
  }
});

els.quoteAudio.addEventListener("play", () => {
  setAudioButton(true);
  els.audioStatus.textContent = "再生中";
});
els.quoteAudio.addEventListener("pause", () => {
  setAudioButton(false);
  if (!els.quoteAudio.ended) els.audioStatus.textContent = "一時停止";
});
els.quoteAudio.addEventListener("ended", () => {
  setAudioButton(false);
  els.audioStatus.textContent = "もう一度聴く";
});
els.quoteAudio.addEventListener("error", () => {
  els.playQuote.disabled = true;
  els.audioStatus.textContent = "お手本音声を読み込めませんでした";
});

els.recordButton.addEventListener("click", toggleRecording);
els.deleteRecording.addEventListener("click", deleteCurrentRecording);
els.quoteSearch.addEventListener("input", (event) => renderQuoteList(event.target.value));
els.quoteList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-quote-id]");
  if (item) selectQuote(item.dataset.quoteId);
});

window.addEventListener("hashchange", () => {
  let id = "";
  try {
    id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  } catch {
    return;
  }
  if (id && state.quotes.some((quote) => quote.id === id)) selectQuote(id, false);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // The app remains usable without offline caching.
    });
  });
}

init();
