import { execFileSync, spawnSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const DATA_PATH = path.join(ROOT, "data", "quotes.json");
const AUDIO_DIR = path.join(ROOT, "audio");
const API_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const LANGUAGE_CODE = process.env.GOOGLE_TTS_LANGUAGE || "ja-JP";
const VOICE_NAME = process.env.GOOGLE_TTS_VOICE || "ja-JP-Standard-B";
const SPEAKING_RATE = Number(process.env.GOOGLE_TTS_SPEAKING_RATE || "0.92");
const FORCE_AUDIO = process.env.FORCE_AUDIO === "1";
let apiKeyUnavailable = false;

function plainText(rubyText) {
  return rubyText.replace(/\[[^\]]+\]/g, "");
}

function safeGcloud(args) {
  const commands =
    process.platform === "win32"
      ? [
          ["cmd.exe", ["/d", "/c", "gcloud.cmd", ...args]],
          ["gcloud.exe", args],
          ["gcloud", args],
        ]
      : [["gcloud", args]];
  for (const [command, commandArgs] of commands) {
    try {
      return execFileSync(command, commandArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // Try the next executable name or report the combined failure below.
    }
  }
  return "";
}

function quotaProject() {
  const fromEnv =
    process.env.GOOGLE_TTS_QUOTA_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    "";
  return fromEnv.trim() || safeGcloud(["config", "get-value", "project"]);
}

function accessToken() {
  return safeGcloud(["auth", "print-access-token"]);
}

async function requestSpeech(text, auth) {
  const headers = { "content-type": "application/json" };
  let url = API_URL;

  if (auth.type === "api-key") {
    url += "?key=" + encodeURIComponent(auth.value);
  } else {
    headers.authorization = "Bearer " + auth.value;
    headers["x-goog-user-project"] = auth.quotaProject;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { text },
      voice: {
        languageCode: LANGUAGE_CODE,
        name: VOICE_NAME,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: SPEAKING_RATE,
        pitch: 0,
      },
    }),
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const result = await response.json();
  if (typeof result.audioContent !== "string" || result.audioContent.length < 100) {
    return { ok: false, status: "音声データなし" };
  }

  return { ok: true, audioContent: result.audioContent };
}

async function synthesize(text) {
  const apiKey = (process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
  if (apiKey && !apiKeyUnavailable) {
    const apiResult = await requestSpeech(text, { type: "api-key", value: apiKey });
    if (apiResult.ok) return { ...apiResult, auth: "API key" };
    apiKeyUnavailable = true;
    console.log("APIキー方式は利用できないため、gcloud OAuth方式へ切り替えます。");
  }

  const token = accessToken();
  const project = quotaProject();
  if (!token || !project) {
    throw new Error("Google TTSの認証情報がありません。gcloud auth loginと課金プロジェクト設定を確認してください。");
  }

  const oauthResult = await requestSpeech(text, {
    type: "oauth",
    value: token,
    quotaProject: project,
  });
  if (!oauthResult.ok) {
    throw new Error("Google Cloud Text-to-SpeechがHTTP " + oauthResult.status + "を返しました。");
  }
  return { ...oauthResult, auth: "gcloud OAuth" };
}

function probeAudio(filePath) {
  const commands = process.platform === "win32" ? ["ffprobe.exe", "ffprobe"] : ["ffprobe"];
  for (const command of commands) {
    const result = spawnSync(
      command,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration:format=bit_rate",
        "-of",
        "json",
        filePath,
      ],
      { encoding: "utf8" },
    );
    if (result.error) continue;
    if (result.status !== 0) return null;
    try {
      const parsed = JSON.parse(result.stdout);
      const duration = Number(parsed.format?.duration ?? 0);
      if (!Number.isFinite(duration) || duration <= 0) return null;
      return {
        durationSeconds: Number(duration.toFixed(3)),
        bitRate: Number(parsed.format?.bit_rate ?? 0),
      };
    } catch {
      return null;
    }
  }
  return null;
}

const quotes = JSON.parse(await readFile(DATA_PATH, "utf8"));
if (!Array.isArray(quotes) || quotes.length === 0) {
  throw new Error("data/quotes.jsonに名言がありません。");
}

let authLabel = "";
let generated = 0;
for (const [index, quote] of quotes.entries()) {
  const fileName = quote.id + ".mp3";
  const outputPath = path.join(AUDIO_DIR, fileName);
  let existing = false;
  if (!FORCE_AUDIO) {
    try {
      const info = await stat(outputPath);
      existing = info.isFile() && info.size > 1000;
    } catch {
      existing = false;
    }
  }

  if (!existing) {
    const result = await synthesize(plainText(quote.ruby));
    authLabel = result.auth;
    await writeFile(outputPath, Buffer.from(result.audioContent, "base64"));
    generated += 1;
  }
  console.log((index + 1) + "/" + quotes.length + " " + quote.id + (existing ? " 再利用" : " 生成"));
}

const files = [];
for (const quote of quotes) {
  const fileName = quote.id + ".mp3";
  const outputPath = path.join(AUDIO_DIR, fileName);
  const info = await stat(outputPath);
  if (!info.isFile() || info.size <= 1000) {
    throw new Error(quote.id + "の音声ファイルを確認できません。");
  }
  const probe = probeAudio(outputPath);
  if (!probe) {
    throw new Error(quote.id + "のMP3をffprobeで検証できません。");
  }
  files.push({
    id: quote.id,
    file: fileName,
    bytes: info.size,
    durationSeconds: probe.durationSeconds,
    bitRate: probe.bitRate,
  });
}

await writeFile(
  path.join(AUDIO_DIR, "manifest.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      voice: VOICE_NAME,
      languageCode: LANGUAGE_CODE,
      audioEncoding: "MP3",
      speakingRate: SPEAKING_RATE,
      auth: authLabel || "既存ファイル",
      files,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log("音声生成・検証OK: " + quotes.length + "件、今回生成 " + generated + "件");
