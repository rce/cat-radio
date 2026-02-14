#!/usr/bin/env bash
set -euo pipefail

: "${SPACES_BUCKET:?Set SPACES_BUCKET}"
: "${SPACES_REGION:=ams3}"
: "${SPACES_ENDPOINT:=https://${SPACES_REGION}.digitaloceanspaces.com}"
: "${AWS_ACCESS_KEY_ID:?Set AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?Set AWS_SECRET_ACCESS_KEY}"
MUSIC_DIR="${MUSIC_DIR:-music}"

echo "Syncing ${MUSIC_DIR}/ → s3://${SPACES_BUCKET}/music/"
docker run --rm \
  -e AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY \
  -v "$(cd "$MUSIC_DIR" && pwd)":/music:ro \
  amazon/aws-cli s3 sync /music/ "s3://${SPACES_BUCKET}/music/" \
    --endpoint-url "$SPACES_ENDPOINT" \
    --exclude '.*' \
    --include '*.mp3' --include '*.flac' --include '*.wav' --include '*.ogg' --include '*.m4a'
echo "Done."
