#!/usr/bin/env bash
set -euo pipefail

PORT="${TEST_PORT:-19737}"
TMPDIR="$(mktemp -d)"
trap 'kill "$SERVER_PID" 2>/dev/null; rm -rf "$TMPDIR"' EXIT

echo "==> Installing test dependencies..."
npm install --save-dev @playwright/test 2>&1 | tail -1
npx playwright install chromium 2>&1 | tail -1

echo "==> Building app..."
npm run build

echo "==> Creating test fixtures in $TMPDIR..."
mkdir -p "$TMPDIR/music"
# Generate a 30-second silent MP3 (long enough for quip crossfade)
ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 30 -codec:a libmp3lame -b:a 128k \
  "$TMPDIR/music/Test Artist - Test Track.mp3" 2>/dev/null
echo "WMEW test quip." > "$TMPDIR/quips.txt"

echo "==> Starting server on port $PORT..."
PORT="$PORT" \
  MUSIC_DIR="$TMPDIR/music" \
  CACHE_DIR="$TMPDIR/cache" \
  STATE_FILE="$TMPDIR/state.json" \
  QUIPS_FILE="$TMPDIR/quips.txt" \
  node dist/index.js &
SERVER_PID=$!

# Wait for server to be ready
for i in $(seq 1 30); do
  if curl -s "http://localhost:$PORT" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Server process died" >&2
    exit 1
  fi
  sleep 0.5
done

if ! curl -s "http://localhost:$PORT" >/dev/null 2>&1; then
  echo "Server failed to start on port $PORT" >&2
  exit 1
fi
echo "==> Server ready (pid $SERVER_PID)"

echo "==> Running Playwright tests..."
TEST_PORT="$PORT" npx playwright test "$@"
