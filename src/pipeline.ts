import { spawn, type ChildProcess } from "node:child_process";
import { log } from "./log.js";
import { config } from "./config.js";
import { broadcast } from "./broadcast.js";

const EFFECTS = [
  "highpass=f=30",
  "acompressor=threshold=0.089:ratio=4:attack=5:release=50:makeup=2",
  "loudnorm=I=-14:TP=-1:LRA=11",
  "equalizer=f=3000:t=q:w=1.5:g=2",
  "equalizer=f=100:t=q:w=1:g=1.5",
].join(",");

let encoder: ChildProcess | null = null;

/** Stage 2: long-running PCM → MP3 encoder that broadcasts to all clients. */
function getEncoder(): ChildProcess {
  if (encoder && !encoder.killed) return encoder;

  encoder = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-readrate", "1",
    "-readrate_initial_burst", "10",
    "-f", "s16le",
    "-ar", String(config.sampleRate),
    "-ac", String(config.channels),
    "-i", "pipe:0",
    "-codec:a", "libmp3lame",
    "-b:a", config.bitrate,
    "-f", "mp3",
    "pipe:1",
  ], { stdio: ["pipe", "pipe", "pipe"] });

  encoder.stdout!.on("data", (chunk: Buffer) => broadcast(chunk));
  encoder.stderr!.on("data", (d: Buffer) => log.warn("encoder:", d.toString().trim()));
  encoder.on("exit", (code) => log.error(`Encoder exited (code ${code})`));

  log.info("MP3 encoder started");
  return encoder;
}

/** Get audio duration in seconds via ffprobe. */
export function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let output = "";
    probe.stdout!.on("data", (d: Buffer) => { output += d.toString(); });
    probe.on("exit", (code) => {
      if (code === 0) resolve(parseFloat(output.trim()));
      else reject(new Error(`ffprobe failed for ${filePath}`));
    });
    probe.on("error", reject);
  });
}

/** Pipe an FFmpeg child's stdout into the encoder and resolve on exit. */
function pipeToEncoder(decoder: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const enc = getEncoder();
    decoder.stdout!.pipe(enc.stdin!, { end: false });

    decoder.stderr!.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) log.warn(`${label}:`, msg);
    });

    decoder.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });

    decoder.on("error", reject);
  });
}

/** Decode a single track with radio effects. Supports seek and duration limit. */
export function decodeTrack(
  filePath: string,
  opts?: { ss?: number; duration?: number },
): Promise<void> {
  const inputArgs: string[] = [];
  if (opts?.ss) inputArgs.push("-ss", String(opts.ss));
  inputArgs.push("-i", filePath);

  const outputArgs: string[] = [];
  if (opts?.duration && opts.duration > 0) {
    outputArgs.push("-t", String(opts.duration));
  }

  const decoder = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    ...inputArgs,
    "-af", EFFECTS,
    ...outputArgs,
    "-f", "s16le",
    "-ar", String(config.sampleRate),
    "-ac", String(config.channels),
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  return pipeToEncoder(decoder, "decoder");
}

/**
 * Crossfade: tail of track A fades out, head of track B fades in,
 * mixed together with a DJ quip on top (music ducked via sidechain).
 */
export function decodeCrossfade(
  trackA: string,
  trackB: string,
  quipPath: string,
  overlap: number,
  trackADuration: number,
): Promise<void> {
  const seekA = Math.max(0, trackADuration - overlap);

  const filterComplex = [
    `[0:a]${EFFECTS},afade=t=out:st=0:d=${overlap}[tail]`,
    `[1:a]${EFFECTS},afade=t=in:st=0:d=${overlap}[head]`,
    `[tail][head]amix=inputs=2:duration=longest:normalize=0[music]`,
    `[2:a]loudnorm=I=-14:TP=-1:LRA=11,asplit=2[voice][sc]`,
    `[music][sc]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=800:level_sc=0.8[ducked]`,
    `[ducked][voice]amix=inputs=2:duration=longest:normalize=0[out]`,
  ].join(";");

  const decoder = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-ss", String(seekA), "-t", String(overlap), "-i", trackA,
    "-t", String(overlap), "-i", trackB,
    "-i", quipPath,
    "-filter_complex", filterComplex,
    "-map", "[out]",
    "-f", "s16le",
    "-ar", String(config.sampleRate),
    "-ac", String(config.channels),
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  return pipeToEncoder(decoder, "crossfade");
}
