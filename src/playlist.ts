import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { log } from "./log.js";
import { config } from "./config.js";

/** Recursively find all .mp3 files under `dir`. */
async function scanMp3s(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...(await scanMp3s(full)));
    } else if (e.name.toLowerCase().endsWith(".mp3")) {
      results.push(full);
    }
  }
  return results;
}

/** Fisher-Yates in-place shuffle. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class Playlist {
  private tracks: string[] = [];
  private idx = 0;

  /** Initialize — optionally resume from saved state. */
  async init(savedTracks?: string[], savedIndex?: number): Promise<void> {
    const allFiles = await scanMp3s(config.musicDir);
    if (allFiles.length === 0) {
      throw new Error(`No MP3 files found in ${config.musicDir}`);
    }
    log.info(`Found ${allFiles.length} tracks in ${config.musicDir}`);

    if (savedTracks?.length) {
      // Keep only tracks that still exist on disk
      const existing = new Set(allFiles);
      this.tracks = savedTracks.filter((t) => existing.has(t));
      this.idx = Math.min(savedIndex ?? 0, this.tracks.length);

      if (this.tracks.length > 0 && this.idx < this.tracks.length) {
        log.info(
          `Resuming playlist at track ${this.idx + 1}/${this.tracks.length}`,
        );
        return;
      }
    }

    this.tracks = shuffle([...allFiles]);
    this.idx = 0;
    log.info("Shuffled playlist");
  }

  /** Get the next track, reshuffling (with rescan) when exhausted. */
  async next(): Promise<string> {
    if (this.idx >= this.tracks.length) {
      const allFiles = await scanMp3s(config.musicDir);
      this.tracks = shuffle([...allFiles]);
      this.idx = 0;
      log.info(`Reshuffled playlist (${this.tracks.length} tracks)`);
    }
    return this.tracks[this.idx++];
  }

  /** Serializable snapshot for persistence. */
  getState(): { tracks: string[]; index: number } {
    return { tracks: [...this.tracks], index: this.idx };
  }
}
