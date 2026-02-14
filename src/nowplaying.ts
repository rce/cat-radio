import { basename } from "node:path";

export interface QuipEntry {
  text: string;
  at: string;
}

export interface NowPlaying {
  track: { artist: string; title: string } | null;
  quips: QuipEntry[];
  listeners: number;
}

const MAX_QUIPS = 10;

let currentTrack: NowPlaying["track"] = null;
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

export function setNowPlaying(filePath: string): void {
  currentTrack = parseTrackName(filePath);
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
    quips: [...recentQuips],
    listeners: listenerCount,
  };
}
