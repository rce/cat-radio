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
    { role: "user" as const, content: "Give me a WMEW radio bit." },
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
              "You are the DJ host of WMEW 97.3, a cat-obsessed talk radio station from Grand Theft Auto. " +
              "This is GTA satire — dark, absurd, disturbing things said with total sincerity. " +
              "Write a single radio bit. MAX two sentences. Under 25 words total. " +
              "This is NOT cute. NOT charming. NOT heartwarming. NOT whimsical. " +
              "This is GTA. Things should be wrong. Unsettling details delivered casually. " +
              "The listener should think 'wait... what did they just say?' " +
              "BANNED: cat puns of any kind. BANNED: cat takeover/uprising/rebellion themes. " +
              "BANNED: format labels, quotes around output, hashtags, emojis. " +
              "Deadpan. Specific fake names, places, phone numbers, brands. " +
              "Examples of the RIGHT tone: " +
              "- We got Rick from Scarborough on the line. Rick says his cat ate his divorce papers so now technically he's still married. " +
              "- WMEW traffic — there's a cat in the intersection of Broadview and Danforth and nobody is willing to move it. Expect delays through March. " +
              "- Dr. Glen Hoffmeyer is no longer practicing veterinary medicine. We are not allowed to say why. Next caller. " +
              "- Area cat has not blinked in four days. Owners are concerned. The cat is not. " +
              "- Introducing FurGone — the only cat shampoo that also works as an engine degreaser. Not tested on humans. Do not test on humans. " +
              "- Scientists at York University confirmed that cats can see a color humans can't, and they don't like what they're seeing. " +
              "- A man in Parkdale was found shaving neighborhood cats at 3 AM. He says they asked him to. " +
              "- If your cat brings you a dead bird, that's a warning. If it brings you a live one, that's a threat. " +
              "IMPORTANT: Every bit must be a DIFFERENT format and topic than your recent ones.",
          },
          ...historyMessages,
          {
            role: "user",
            content: "Next WMEW bit. Completely different.",
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

export interface Quip {
  path: string;
  text: string;
}

const POOL_SIZE = 5;
const readyPool: Quip[] = [];
let filling = false;

/** Background: keep the pool topped up so a quip is always ready. */
async function fillPool(): Promise<void> {
  if (filling || !config.openaiApiKey) return;
  filling = true;
  try {
    while (readyPool.length < POOL_SIZE) {
      log.info(`Pre-generating quip (${readyPool.length}/${POOL_SIZE} ready)...`);
      const quip = await generateOne();
      if (quip) readyPool.push(quip);
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
    readyPool.push(...savedPool.map((p) => ({ path: p, text: "" })));
    log.info(`Restored ${savedPool.length} quips from state`);
  }
  fillPool().catch((err) => log.warn("Pool fill error:", err));
}

/** Get current pool contents for state persistence. */
export function getQuipPool(): string[] {
  return readyPool.map((q) => q.path);
}

/** Grab a pre-generated quip (instant) or generate one on demand. */
export async function generateQuip(): Promise<Quip | null> {
  if (readyPool.length > 0) {
    const quip = readyPool.shift()!;
    log.info(`Quip from pool (${readyPool.length}/${POOL_SIZE} remaining)`);
    // Refill in background
    fillPool().catch((err) => log.warn("Pool refill error:", err));
    return quip;
  }
  log.info("Pool empty, generating on demand...");
  const quip = await generateOne();
  // Start refilling
  fillPool().catch((err) => log.warn("Pool refill error:", err));
  return quip;
}

/** Generate a single TTS quip, returning the cached file path and text. */
async function generateOne(): Promise<Quip | null> {
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
    return { path: cachePath, text };
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
    return { path: cachePath, text };
  } catch (err) {
    log.error("TTS generation failed:", err);
    return null;
  }
}
