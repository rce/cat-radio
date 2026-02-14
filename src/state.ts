import { readFile, writeFile, access } from "node:fs/promises";
import { config } from "./config.js";
import { log } from "./log.js";
import { loadStateFromSpaces, saveStateToSpaces } from "./spaces.js";

import type { QuipEntry } from "./nowplaying.js";
import type { Quip } from "./tts.js";

export interface RadioState {
  tracks: string[];
  index: number;
  quipPool: Quip[];
  recentQuips: QuipEntry[];
}

export async function loadState(): Promise<RadioState | null> {
  await loadStateFromSpaces();
  try {
    const data = JSON.parse(await readFile(config.stateFile, "utf-8"));
    if (Array.isArray(data.tracks) && typeof data.index === "number") {
      // Validate quip pool — only keep entries whose audio still exists on disk
      // Handles both new { path, text } format and old string[] format
      const pool: Quip[] = [];
      for (const entry of data.quipPool ?? []) {
        const path = typeof entry === "string" ? entry : entry?.path;
        const text = typeof entry === "string" ? "" : (entry?.text ?? "");
        if (!path) continue;
        try {
          await access(path);
          pool.push({ path, text });
        } catch {
          // file gone, skip
        }
      }
      log.info(
        `Loaded state: track ${data.index}/${data.tracks.length}, ` +
          `${pool.length} cached quips`,
      );
      return {
        tracks: data.tracks,
        index: data.index,
        quipPool: pool,
        recentQuips: Array.isArray(data.recentQuips) ? data.recentQuips : [],
      };
    }
  } catch {
    // No state file or invalid — start fresh
  }
  return null;
}

export async function saveState(state: RadioState): Promise<void> {
  try {
    await writeFile(config.stateFile, JSON.stringify(state));
    await saveStateToSpaces();
  } catch (err) {
    log.warn("Failed to save state:", err);
  }
}
