import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

export interface QuipEntry {
  text: string;
  at: string;
}

export interface TrackInfo {
  artist: string;
  title: string;
}

export interface NowPlaying {
  track: TrackInfo | null;
  history: TrackInfo[];
  upcoming: TrackInfo[];
  quips: QuipEntry[];
  listeners: number;
  version: string;
}

const MAX_QUIPS = 4;

function loadVersion(): string {
  try {
    return readFileSync("COMMIT_HASH", "utf-8").trim();
  } catch {
    return Date.now().toString(36);
  }
}
const VERSION = loadVersion();

const MAX_HISTORY = 2;

let currentTrack: TrackInfo | null = null;
const trackHistory: TrackInfo[] = [];
let upcomingTracks: TrackInfo[] = [];
const recentQuips: QuipEntry[] = [];
let listenerCount = 0;

/** Parse "Artist - Title.mp3" → { artist, title }. Falls back gracefully. */
function parseTrackName(filePath: string): { artist: string; title: string } {
  const name = basename(filePath).replace(/\.[^.]+$/, "");
  const sep = name.indexOf(" - ");
  if (sep > 0) {
    return { artist: name.slice(0, sep), title: name.slice(sep + 3) };
  }
  return { artist: "", title: name };
}

/** Read ID3 tags via ffprobe, falling back to filename parsing. */
function probeTrackMeta(filePath: string): Promise<TrackInfo> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (chunk: Buffer) => { out += chunk; });
    proc.on("close", (code) => {
      if (code === 0) {
        try {
          const tags = JSON.parse(out)?.format?.tags;
          if (tags?.artist && tags?.title) {
            resolve({ artist: tags.artist, title: tags.title });
            return;
          }
        } catch { /* fall through */ }
      }
      resolve(parseTrackName(filePath));
    });
    proc.on("error", () => resolve(parseTrackName(filePath)));
  });
}

export async function setNowPlaying(filePath: string): Promise<void> {
  if (currentTrack) {
    trackHistory.unshift(currentTrack);
    if (trackHistory.length > MAX_HISTORY) trackHistory.length = MAX_HISTORY;
  }
  currentTrack = await probeTrackMeta(filePath);
}

export async function setUpcoming(paths: string[]): Promise<void> {
  upcomingTracks = await Promise.all(paths.map(probeTrackMeta));
}

export function getTrackHistory(): TrackInfo[] {
  return [...trackHistory];
}

export function restoreTrackHistory(history: TrackInfo[]): void {
  trackHistory.push(...history.slice(0, MAX_HISTORY));
}

/** Restore quips from persisted state on startup. */
export function restoreQuips(quips: QuipEntry[]): void {
  recentQuips.push(...quips.slice(0, MAX_QUIPS));
}

export function pushQuip(text: string): void {
  recentQuips.unshift({ text, at: new Date().toISOString() });
  if (recentQuips.length > MAX_QUIPS) recentQuips.length = MAX_QUIPS;
}

/** Get quips for state persistence. */
export function getRecentQuips(): QuipEntry[] {
  return [...recentQuips];
}

export function setListeners(n: number): void {
  listenerCount = n;
}

export function getNowPlaying(): NowPlaying {
  return {
    track: currentTrack,
    history: [...trackHistory],
    upcoming: [...upcomingTracks],
    quips: [...recentQuips],
    listeners: listenerCount,
    version: VERSION,
  };
}
