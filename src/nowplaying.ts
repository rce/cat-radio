import { basename } from "node:path";
import { readFileSync } from "node:fs";

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

const MAX_QUIPS = 10;

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

export function setNowPlaying(filePath: string): void {
  if (currentTrack) {
    trackHistory.unshift(currentTrack);
    if (trackHistory.length > MAX_HISTORY) trackHistory.length = MAX_HISTORY;
  }
  currentTrack = parseTrackName(filePath);
}

export function setUpcoming(paths: string[]): void {
  upcomingTracks = paths.map(parseTrackName);
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
