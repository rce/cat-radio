import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { config } from "./config.js";
import { log } from "./log.js";

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!config.spacesBucket) return null;
  if (!client) {
    client = new S3Client({
      region: config.spacesRegion,
      endpoint: config.spacesEndpoint,
      credentials: {
        accessKeyId: config.spacesKey,
        secretAccessKey: config.spacesSecret,
      },
      forcePathStyle: false,
    });
  }
  return client;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function listAllKeys(prefix: string): Promise<string[]> {
  const s3 = getClient();
  if (!s3) return [];
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.spacesBucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

async function downloadFile(key: string, localPath: string): Promise<void> {
  const s3 = getClient()!;
  const res = await s3.send(
    new GetObjectCommand({ Bucket: config.spacesBucket, Key: key }),
  );
  const body = res.Body as Readable;
  const buf = await streamToBuffer(body);
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, buf);
}

async function syncPrefix(prefix: string, localDir: string): Promise<void> {
  const s3 = getClient();
  if (!s3) return;
  const keys = await listAllKeys(prefix);
  log.info(`Spaces: ${keys.length} objects under "${prefix}"`);
  for (const key of keys) {
    // key is e.g. "music/song.mp3" → local "music/song.mp3"
    const relative = key.slice(prefix.length);
    if (!relative) continue; // skip the prefix itself
    const localPath = join(localDir, relative);
    try {
      await downloadFile(key, localPath);
    } catch (err) {
      log.warn(`Spaces: failed to download ${key}:`, err);
    }
  }
}

export async function syncMusicFromSpaces(): Promise<void> {
  await syncPrefix("music/", config.musicDir);
}

export async function syncCacheFromSpaces(): Promise<void> {
  await syncPrefix("cache/", config.cacheDir);
}

export async function loadStateFromSpaces(): Promise<void> {
  const s3 = getClient();
  if (!s3) return;
  try {
    const res = await s3.send(
      new GetObjectCommand({
        Bucket: config.spacesBucket,
        Key: "state.json",
      }),
    );
    const body = res.Body as Readable;
    const buf = await streamToBuffer(body);
    await writeFile(config.stateFile, buf);
    log.info("Spaces: downloaded state.json");
  } catch (err: any) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      log.info("Spaces: no state.json found, starting fresh");
    } else {
      log.warn("Spaces: failed to download state.json:", err);
    }
  }
}

export async function saveStateToSpaces(): Promise<void> {
  const s3 = getClient();
  if (!s3) return;
  try {
    const data = await readFile(config.stateFile);
    await s3.send(
      new PutObjectCommand({
        Bucket: config.spacesBucket,
        Key: "state.json",
        Body: data,
        ContentType: "application/json",
      }),
    );
  } catch (err) {
    log.warn("Spaces: failed to upload state.json:", err);
  }
}

export async function uploadCacheFile(localPath: string): Promise<void> {
  const s3 = getClient();
  if (!s3) return;
  try {
    const data = await readFile(localPath);
    // localPath is e.g. "cache/abc123.mp3" — use as key directly
    const key = localPath.startsWith(config.cacheDir)
      ? "cache/" + localPath.slice(config.cacheDir.length + 1)
      : localPath;
    await s3.send(
      new PutObjectCommand({
        Bucket: config.spacesBucket,
        Key: key,
        Body: data,
        ContentType: "audio/mpeg",
      }),
    );
  } catch (err) {
    log.warn(`Spaces: failed to upload cache file ${localPath}:`, err);
  }
}
