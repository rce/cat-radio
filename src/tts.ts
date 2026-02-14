import { readFile, writeFile, appendFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { log } from "./log.js";
import { config } from "./config.js";
import { uploadCacheFile } from "./spaces.js";

let quipLines: string[] = [];

/** Load pre-written quips from file. */
async function loadQuips(): Promise<void> {
  try {
    const text = await readFile(config.quipsFile, "utf-8");
    quipLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    log.info(`Loaded ${quipLines.length} quip lines`);
  } catch {
    log.warn(`Could not read ${config.quipsFile}, using AI-only quips`);
  }
}

const HISTORY_SIZE = 5;
const recentQuips: string[] = [];

/** Pick a quip: AI-generated first, pre-written only as last resort. */
async function getQuipText(): Promise<string> {
  if (quipLines.length === 0) await loadQuips();

  if (!config.openaiApiKey) {
    const line = quipLines[Math.floor(Math.random() * quipLines.length)];
    log.info(`Quip text (pre-written, no API key): "${line}"`);
    return line;
  }

  const historyMessages = recentQuips.map((q) => [
    { role: "user" as const, content: "次のWMEWネタ。前と全然違うやつ。" },
    { role: "assistant" as const, content: q },
  ]).flat();

  log.info("Generating AI quip...");
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: config.chatModel,
        messages: [
          {
            role: "system",
            content:
              "あなたはWMEW 97.3のDJホスト。猫に取り憑かれたGTAスタイルのトークラジオ局。" +
              "GTAの風刺 — 暗くて不条理で不穏な内容を、完全に真面目に言う。" +
              "ラジオの一言ネタを一つ書け。最大2文。合計30文字以内。日本語で書くこと。" +
              "可愛くない。癒し系でもない。ほのぼのでもない。" +
              "GTAだ。何かがおかしい。不穏な詳細をさりげなく伝える。" +
              "リスナーに「え…今なんて言った？」と思わせろ。" +
              "禁止：猫のダジャレ全般。禁止：猫の世界征服・反乱テーマ。" +
              "禁止：フォーマットラベル、引用符、ハッシュタグ、絵文字。" +
              "淡々と。架空の具体的な名前、地名、電話番号、ブランド名を使え。" +
              "正しいトーンの例：" +
              "- 練馬区の田中さんから電話です。猫が離婚届を食べたので法的にはまだ結婚してるそうです。" +
              "- WMEW交通情報 — 国道246号線の交差点に猫がいます。誰も動かす気がありません。3月まで渋滞の見込み。" +
              "- 獣医の山田先生はもう開業していません。理由は言えません。次の電話どうぞ。" +
              "- 地域の猫が4日間まばたきしていません。飼い主は心配しています。猫はしていません。" +
              "- 新商品「ネコピカ」— 猫用シャンプー兼エンジン洗浄剤。人間での使用は未検証。人間に使うな。" +
              "- 東京大学の研究者が確認：猫は人間に見えない色が見える。そして見えてるものが気に入らないらしい。" +
              "- 深夜3時に近所の猫を剃っている男が世田谷で見つかりました。本人曰く「頼まれた」とのこと。" +
              "- 猫が死んだ鳥を持ってきたら警告です。生きた鳥を持ってきたら脅迫です。" +
              "重要：毎回、直近のネタと全く違うフォーマットとトピックにすること。",
          },
          ...historyMessages,
          {
            role: "user",
            content: "次のWMEWネタ。前と全然違うやつ。",
          },
        ],
        max_tokens: 50,
        temperature: 1.2,
      }),
    });
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (text) {
      log.info(`Quip text (AI): "${text}"`);
      recentQuips.push(text);
      if (recentQuips.length > HISTORY_SIZE) recentQuips.shift();
      return text;
    }
    log.warn("AI quip response had no content:", JSON.stringify(data));
  } catch (err) {
    log.warn("AI quip generation failed:", err);
  }

  // Fallback to pre-written
  if (quipLines.length > 0) {
    const line = quipLines[Math.floor(Math.random() * quipLines.length)];
    log.info(`Quip text (fallback): "${line}"`);
    return line;
  }
  return "You're listening to WMEW.";
}

/** Append quip text to a persistent log file. */
async function logQuip(text: string, hash: string): Promise<void> {
  const line = `[${new Date().toISOString()}] ${hash.slice(0, 12)} | ${text}\n`;
  try {
    await appendFile("quips.log", line);
  } catch {
    // non-critical
  }
}

const VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;

function pickVoice(): string {
  return VOICES[Math.floor(Math.random() * VOICES.length)];
}

/** SHA256 hash of text + voice for unique caching per voice. */
function hashQuip(text: string, voice: string): string {
  return createHash("sha256").update(`${voice}:${text}`).digest("hex");
}

const POOL_SIZE = 5;
const readyPool: string[] = [];
let filling = false;

/** Background: keep the pool topped up so a quip is always ready. */
async function fillPool(): Promise<void> {
  if (filling || !config.openaiApiKey) return;
  filling = true;
  try {
    while (readyPool.length < POOL_SIZE) {
      log.info(`Pre-generating quip (${readyPool.length}/${POOL_SIZE} ready)...`);
      const path = await generateOne();
      if (path) readyPool.push(path);
      else break; // API issue, stop trying
    }
    log.info(`Quip pool full (${readyPool.length}/${POOL_SIZE})`);
  } finally {
    filling = false;
  }
}

/** Load saved pool paths and start filling the rest in background. */
export function warmQuipPool(savedPool?: string[]): void {
  if (savedPool?.length) {
    readyPool.push(...savedPool);
    log.info(`Restored ${savedPool.length} quips from state`);
  }
  fillPool().catch((err) => log.warn("Pool fill error:", err));
}

/** Get current pool contents for state persistence. */
export function getQuipPool(): string[] {
  return [...readyPool];
}

/** Grab a pre-generated quip (instant) or generate one on demand. */
export async function generateQuip(): Promise<string | null> {
  if (readyPool.length > 0) {
    const path = readyPool.shift()!;
    log.info(`Quip from pool (${readyPool.length}/${POOL_SIZE} remaining)`);
    // Refill in background
    fillPool().catch((err) => log.warn("Pool refill error:", err));
    return path;
  }
  log.info("Pool empty, generating on demand...");
  const path = await generateOne();
  // Start refilling
  fillPool().catch((err) => log.warn("Pool refill error:", err));
  return path;
}

/** Generate a single TTS quip, returning the cached file path. */
async function generateOne(): Promise<string | null> {
  if (!config.openaiApiKey) {
    log.warn("generateQuip called but no OPENAI_API_KEY");
    return null;
  }

  await loadQuips();
  log.info("Picking quip text...");
  const text = await getQuipText();
  const voice = pickVoice();
  const hash = hashQuip(text, voice);
  const cachePath = join(config.cacheDir, `${hash}.mp3`);

  // Check cache
  try {
    await access(cachePath);
    log.info(`Quip cache hit: "${text.slice(0, 40)}..."`);
    return cachePath;
  } catch {
    // Not cached, generate
  }

  try {
    await mkdir(config.cacheDir, { recursive: true });

    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: "tts-1-hd",
        voice,
        input: text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`TTS API error: ${res.status} ${res.statusText} — ${body}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    log.info(`TTS response: ${buffer.length} bytes`);
    await writeFile(cachePath, buffer);
    log.info(`Cached quip [${voice}]: "${text.slice(0, 40)}..." → ${hash.slice(0, 12)}.mp3`);
    await uploadCacheFile(cachePath);
    await logQuip(text, hash);
    return cachePath;
  } catch (err) {
    log.error("TTS generation failed:", err);
    return null;
  }
}
