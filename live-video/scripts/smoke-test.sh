#!/usr/bin/env bash
# End-to-end smoke test for MODE=multicam — no real cameras required.
#
# This script:
#   1. Validates required binaries (ffmpeg, mediamtx, python3).
#   2. Starts MediaMTX in the background.
#   3. Pushes 1..N MP4 fixtures into MediaMTX as fake cameras using
#      `ffmpeg -re -stream_loop -1`.
#   4. Runs broadcast.py with stdout discarded (no YouTube push).
#   5. Polls the /status endpoint, prints the selection + scores once a second.
#
# Run from the live-video directory:
#   ./scripts/smoke-test.sh
#
# Override fixtures dir via env:
#   FIXTURES_DIR=/tmp/clips ./scripts/smoke-test.sh
#
# Stop with Ctrl-C; the script kills all children and exits.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LV_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AI_DIR="$LV_DIR/ai-service"
FIXTURES_DIR="${FIXTURES_DIR:-$LV_DIR/fixtures}"
MEDIAMTX_BIN="${MEDIAMTX_BIN:-/opt/mediamtx/mediamtx}"
MEDIAMTX_CONFIG="$LV_DIR/mediamtx/mediamtx.yml"
STATUS_URL="http://127.0.0.1:8888/status"

PIDS=()
cleanup() {
  echo "[smoke] shutting down..." >&2
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "[smoke] missing: $1" >&2; exit 1; }
}

require ffmpeg
require python3
require curl
[[ -x "$MEDIAMTX_BIN" ]] || { echo "[smoke] MEDIAMTX_BIN not executable: $MEDIAMTX_BIN" >&2; exit 1; }
[[ -f "$MEDIAMTX_CONFIG" ]] || { echo "[smoke] mediamtx config not found: $MEDIAMTX_CONFIG" >&2; exit 1; }

# Find fixtures
shopt -s nullglob
fixtures=("$FIXTURES_DIR"/cam*.mp4)
if [[ ${#fixtures[@]} -eq 0 ]]; then
  echo "[smoke] no fixtures found in $FIXTURES_DIR" >&2
  echo "        Place cam1.mp4, cam2.mp4, cam3.mp4 in that directory." >&2
  echo "        Quick option: download any short baseball clip and copy it 3 times." >&2
  exit 1
fi

# 1. MediaMTX
echo "[smoke] starting mediamtx..." >&2
"$MEDIAMTX_BIN" "$MEDIAMTX_CONFIG" >/tmp/mediamtx.log 2>&1 &
PIDS+=($!)
sleep 1

# 2. FFmpeg pushers (one per fixture)
i=1
for f in "${fixtures[@]}"; do
  cam="cam$i"
  echo "[smoke] pushing $f -> rtmp://localhost:1935/$cam" >&2
  ffmpeg -hide_banner -loglevel error \
    -re -stream_loop -1 -i "$f" \
    -c:v libx264 -preset ultrafast -tune zerolatency -g 60 -an \
    -f flv "rtmp://localhost:1935/$cam" \
    >/tmp/push-$cam.log 2>&1 &
  PIDS+=($!)
  i=$((i + 1))
  if [[ $i -gt 8 ]]; then break; fi
done

# Give the streams a moment to register.
sleep 2

# 3. Broadcast — discard the BGR pipe (we're not pushing to YouTube here).
echo "[smoke] starting broadcast.py (output discarded)" >&2
python3 "$AI_DIR/broadcast.py" --config "$LV_DIR/cameras.yaml" \
  >/dev/null 2>/tmp/broadcast.log &
PIDS+=($!)

# 4. Poll /status forever; print a one-line summary every second.
echo "[smoke] polling $STATUS_URL — Ctrl-C to stop" >&2
sleep 3
while sleep 1; do
  if ! resp=$(curl -fsS "$STATUS_URL" 2>/dev/null); then
    echo "[smoke] status_server not ready yet"
    continue
  fi
  python3 - <<EOF
import json, sys
s = json.loads('''$resp''')
cams = " ".join(
    f"{cid}:{round(c['ewma'],3)}" for cid, c in sorted(s['cameras'].items())
)
print(f"current={s['current']:>5}  challenger={s.get('challenger') or '-':>5}  "
      f"ball_recent={s['global_ball_recent']}  override={s.get('overridden') or '-'}  ewma=[{cams}]")
EOF
done
