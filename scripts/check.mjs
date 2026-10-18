import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const DATA_PATH = path.join(ROOT, "data", "quotes.json");
const AUDIO_DIR = path.join(ROOT, "audio");
const REQUIRE_AUDIO = process.argv.includes("--require-audio");

function fail(message) {
  console.error("チェック失敗: " + message);
  process.exitCode = 1;
}

function hanWithoutRuby(value) {
  const withoutRuby = value.replace(/(?:\p{Script=Han}|々)+\[[^\]]+\]/gu, "");
  return [...withoutRuby.matchAll(/(?:\p{Script=Han}|々)/gu)].map((match) => match[0]);
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function probeAudio(filePath) {
  const result = spawnSync(
    "ffprobe",
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

  if (result.error || result.status !== 0) {
    return { ok: false, message: "ffprobeで読み取れません" };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    const duration = Number(parsed.format?.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      return { ok: false, message: "再生時間がありません" };
    }
    return {
      ok: true,
      durationSeconds: Number(duration.toFixed(3)),
      bitRate: Number(parsed.format?.bit_rate ?? 0),
    };
  } catch {
    return { ok: false, message: "ffprobeの結果を解釈できません" };
  }
}

let quotes;
try {
  quotes = await loadJson(DATA_PATH);
} catch (error) {
  fail("quotes.jsonを読み込めません: " + error.message);
  process.exit();
}

if (!Array.isArray(quotes) || quotes.length !== 300) {
  fail("名言数が300件ではありません: " + (Array.isArray(quotes) ? quotes.length : "配列ではありません"));
}

const ids = new Set();
for (const [index, quote] of (Array.isArray(quotes) ? quotes : []).entries()) {
  const label = "項目 " + (index + 1);
  if (!quote || typeof quote !== "object") {
    fail(label + "がオブジェクトではありません");
    continue;
  }
  if (!/^q\d{3}$/.test(quote.id)) fail(label + "のIDが不正です: " + quote.id);
  if (ids.has(quote.id)) fail("IDが重複しています: " + quote.id);
  ids.add(quote.id);
  for (const field of ["ruby", "author", "source", "category", "sourceUrl"]) {
    if (typeof quote[field] !== "string" || quote[field].trim() === "") {
      fail(quote.id + "の" + field + "が空です");
    }
  }
  if (typeof quote.ruby === "string") {
    const missing = hanWithoutRuby(quote.ruby);
    if (missing.length > 0) {
      fail(quote.id + "にルビのない漢字があります: " + [...new Set(missing)].join(""));
    }
    const plain = quote.ruby.replace(/\[[^\]]+\]/g, "").trim();
    if (!plain) fail(quote.id + "の本文が空です");
  }
  if (typeof quote.sourceUrl === "string" && !/^https:\/\//.test(quote.sourceUrl)) {
    fail(quote.id + "の出典URLがHTTPSではありません");
  }
}

if (!REQUIRE_AUDIO) {
  if (process.exitCode) process.exit(1);
  console.log("データチェックOK: " + quotes.length + "件");
  process.exit(0);
}

let manifest;
try {
  manifest = await loadJson(path.join(AUDIO_DIR, "manifest.json"));
} catch (error) {
  fail("audio/manifest.jsonを読み込めません: " + error.message);
  process.exit(1);
}

if (!Array.isArray(manifest.files)) {
  fail("音声マニフェストのfilesが配列ではありません");
  process.exit(1);
}

const maleVoices = new Set([
  "ja-JP-Standard-C",
  "ja-JP-Standard-D",
  "ja-JP-Neural2-C",
  "ja-JP-Neural2-D",
  "ja-JP-Wavenet-C",
  "ja-JP-Wavenet-D",
]);
if (manifest.voiceGender !== "MALE" || !maleVoices.has(manifest.voice)) {
  fail("埋め込み音声が男性の日本語音声ではありません: " + (manifest.voice || "音声名なし"));
}
if (manifest.languageCode !== "ja-JP") {
  fail("音声の言語コードがja-JPではありません: " + (manifest.languageCode || "言語コードなし"));
}

const manifestIds = new Set(manifest.files.map((file) => file?.id));
for (const quote of quotes) {
  if (!manifestIds.has(quote.id)) {
    fail(quote.id + "が音声マニフェストにありません");
    continue;
  }
  const entry = manifest.files.find((file) => file.id === quote.id);
  const fileName = entry.file || quote.id + ".mp3";
  if (!/^[a-zA-Z0-9_-]+\.mp3$/.test(fileName)) {
    fail(quote.id + "の音声ファイル名が不正です");
    continue;
  }
  const audioPath = path.join(AUDIO_DIR, fileName);
  try {
    const info = await stat(audioPath);
    if (!info.isFile() || info.size < 1000) {
      fail(quote.id + "の音声ファイルが空または小さすぎます");
      continue;
    }
  } catch {
    fail(quote.id + "の音声ファイルがありません: " + fileName);
    continue;
  }
  const probe = probeAudio(audioPath);
  if (!probe.ok) {
    fail(quote.id + "の音声検査に失敗しました: " + probe.message);
  }
}

if (manifestIds.size !== quotes.length) {
  fail("音声マニフェストの件数が名言数と一致しません");
}

if (process.exitCode) process.exit(1);
console.log("全チェックOK: 名言 " + quotes.length + "件、音声 " + manifest.files.length + "件");
