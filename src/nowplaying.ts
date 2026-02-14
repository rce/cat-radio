import { basename } from "node:path";

export interface NowPlaying {
  track: { artist: string; title: string } | null;
  quips: { text: string; at: string }[];
  listeners: number;
}

const MAX_QUIPS = 10;

let currentTrack: NowPlaying["track"] = null;
const recentQuips: NowPlaying["quips"] = [];
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

export function pushQuip(text: string): void {
  recentQuips.unshift({ text, at: new Date().toISOString() });
  if (recentQuips.length > MAX_QUIPS) recentQuips.length = MAX_QUIPS;
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
