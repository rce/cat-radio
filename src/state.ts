import { readFile, writeFile, access } from "node:fs/promises";
import { config } from "./config.js";
import { log } from "./log.js";

export interface RadioState {
  tracks: string[];
  index: number;
  quipPool: string[];
}

export async function loadState(): Promise<RadioState | null> {
  try {
    const data = JSON.parse(await readFile(config.stateFile, "utf-8"));
    if (Array.isArray(data.tracks) && typeof data.index === "number") {
      // Validate quip pool — only keep paths that still exist on disk
      const pool: string[] = [];
      for (const p of data.quipPool ?? []) {
        try {
          await access(p);
          pool.push(p);
        } catch {
          // file gone, skip
        }
      }
      log.info(
        `Loaded state: track ${data.index}/${data.tracks.length}, ` +
          `${pool.length} cached quips`,
      );
      return { tracks: data.tracks, index: data.index, quipPool: pool };
    }
  } catch {
    // No state file or invalid — start fresh
  }
  return null;
}

export async function saveState(state: RadioState): Promise<void> {
  try {
    await writeFile(config.stateFile, JSON.stringify(state));
  } catch (err) {
    log.warn("Failed to save state:", err);
  }
}
