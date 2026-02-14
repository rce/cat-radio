function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: Number(env("PORT", "7777")),
  musicDir: env("MUSIC_DIR", "music"),
  cacheDir: env("CACHE_DIR", "cache"),
  quipsFile: env("QUIPS_FILE", "quips.txt"),

  openaiApiKey: env("OPENAI_API_KEY", ""),
  ttsVoice: env("TTS_VOICE", "onyx"),
  ttsModel: env("TTS_MODEL", "tts-1"),
  chatModel: env("CHAT_MODEL", "gpt-4o-mini"),
  stateFile: env("STATE_FILE", "state.json"),
  spacesBucket: env("SPACES_BUCKET", ""),
  spacesRegion: env("SPACES_REGION", "nyc3"),
  spacesEndpoint: env("SPACES_ENDPOINT", "https://nyc3.digitaloceanspaces.com"),
  spacesKey: env("SPACES_KEY", ""),
  spacesSecret: env("SPACES_SECRET", ""),
  bitrate: env("BITRATE", "128k"),
  sampleRate: 44100,
  channels: 2,
};
