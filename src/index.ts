import { log } from "./log.js";
import { config } from "./config.js";
import { startServer } from "./broadcast.js";
import { decodeTrack, decodeCrossfade, probeDuration } from "./pipeline.js";
import { Playlist } from "./playlist.js";
import { generateQuip, warmQuipPool, getQuipPool } from "./tts.js";
import { loadState, saveState } from "./state.js";
import { syncMusicFromSpaces, syncCacheFromSpaces } from "./spaces.js";
import { basename } from "node:path";

const quipsEnabled = !!config.openaiApiKey;
if (!quipsEnabled) log.warn("No OPENAI_API_KEY — quips disabled");

await syncMusicFromSpaces();
await syncCacheFromSpaces();

startServer();

const saved = await loadState();
const playlist = new Playlist();
await playlist.init(saved?.tracks, saved?.index);
if (quipsEnabled) warmQuipPool(saved?.quipPool);

async function persist(): Promise<void> {
  const { tracks, index } = playlist.getState();
  await saveState({ tracks, index, quipPool: getQuipPool() });
}

while (true) {
  const trackPath = await playlist.next();

  try {
    if (quipsEnabled) {
      const quipPath = await generateQuip();
      if (quipPath) {
        const nextPath = await playlist.next();

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
        continue;
      }
    }

    log.info(`Playing: ${basename(trackPath)}`);
    await decodeTrack(trackPath);
    await persist();
  } catch (err) {
    log.error("Playback error:", err);
  }
}
