import { log } from "./log.js";
import { config } from "./config.js";
import { startServer } from "./broadcast.js";
import { decodeTrack, decodeCrossfade, probeDuration } from "./pipeline.js";
import { Playlist } from "./playlist.js";
import { generateQuip, warmQuipPool, getQuipPool } from "./tts.js";
import { loadState, saveState } from "./state.js";
import {
  listMusicInSpaces,
  ensureMusicFile,
  syncCacheFromSpaces,
} from "./spaces.js";
import { basename } from "node:path";

const PREFETCH_AHEAD = 3;

const quipsEnabled = !!config.openaiApiKey;
if (!quipsEnabled) log.warn("No OPENAI_API_KEY — quips disabled");

await syncCacheFromSpaces();

startServer();

const spacesMusic = await listMusicInSpaces();
const saved = await loadState();
const playlist = new Playlist();
await playlist.init(saved?.tracks, saved?.index, spacesMusic.length ? spacesMusic : undefined);

/** Download the next few tracks in the background so they're ready when needed. */
async function prefetch(): Promise<void> {
  const upcoming = playlist.peek(PREFETCH_AHEAD);
  await Promise.all(upcoming.map((p) => ensureMusicFile(p)));
}
if (quipsEnabled) warmQuipPool(saved?.quipPool);

async function persist(): Promise<void> {
  const { tracks, index } = playlist.getState();
  await saveState({ tracks, index, quipPool: getQuipPool() });
}

await prefetch();

while (true) {
  const trackPath = await playlist.next();
  await ensureMusicFile(trackPath);

  try {
    if (quipsEnabled) {
      const quipPath = await generateQuip();
      if (quipPath) {
        const nextPath = await playlist.next();
        await ensureMusicFile(nextPath);

        const [quipDur, trackDur] = await Promise.all([
          probeDuration(quipPath),
          probeDuration(trackPath),
        ]);

        if (trackDur > quipDur) {
          log.info(`Playing: ${basename(trackPath)}`);
          await decodeTrack(trackPath, { duration: trackDur - quipDur });

          log.info(`Crossfade quip → ${basename(nextPath)}`);
          await decodeCrossfade(
            trackPath,
            nextPath,
            quipPath,
            quipDur,
            trackDur,
          );

          log.info(`Playing: ${basename(nextPath)}`);
          await decodeTrack(nextPath, { ss: quipDur });
        } else {
          log.info(`Playing: ${basename(trackPath)}`);
          await decodeTrack(trackPath);
        }

        await persist();
        prefetch().catch((err) => log.warn("Prefetch error:", err));
        continue;
      }
    }

    log.info(`Playing: ${basename(trackPath)}`);
    await decodeTrack(trackPath);
    await persist();
    prefetch().catch((err) => log.warn("Prefetch error:", err));
  } catch (err) {
    log.error("Playback error:", err);
  }
}
