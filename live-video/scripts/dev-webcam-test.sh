#!/usr/bin/env bash
# Dev-box action-switching test — uses ONE webcam fanned into THREE cropped
# RTMP streams so you can move around in front of the camera and watch the
# director switch.
#
# Layout (1280x720 webcam → three RTMP streams, no upscale):
#   cam1 (batter_box) ← LEFT  800x720 (cols   0–800)   overlaps cam2 in middle 320 cols
#   cam2 (first_base) ← RIGHT 800x720 (cols 480–1280)
#   cam3 (wide)       ← FULL  1280x720 (the whole webcam — default-role cam)
#
# Hold a tennis/soccer/basketball in front of the webcam and move it:
#   ball on the LEFT      → cam1 has it most centered → cam1 wins
#   ball CENTERED         → only cam3 has it centered  → cam3 wins
#   ball on the RIGHT     → cam2 has it most centered → cam2 wins
#   ball gone             → cam3 holds via role_bonus after 5s grace
#
# Run from repo root:
#   ./live-video/scripts/dev-webcam-test.sh
#
# Override the webcam device:
#   WEBCAM=/dev/video1 ./live-video/scripts/dev-webcam-test.sh
#
# Stop with Ctrl-C.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LV_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AI_DIR="$LV_DIR/ai-service"
VENV="$LV_DIR/.venv"
WEBCAM="${WEBCAM:-/dev/video0}"
MEDIAMTX_BIN="${MEDIAMTX_BIN:-$HOME/.local/opt/mediamtx/mediamtx}"
MEDIAMTX_CONFIG="$LV_DIR/mediamtx/mediamtx.yml"
PY="$VENV/bin/python3"
[[ -x "$PY" ]] || PY=python3

PIDS=()
cleanup() {
  echo "[dev] shutting down..." >&2
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "[dev] missing: $1" >&2; exit 1; }
}
require ffmpeg
require curl
[[ -e "$WEBCAM" ]] || { echo "[dev] webcam not found at $WEBCAM" >&2; exit 1; }
[[ -x "$MEDIAMTX_BIN" ]] || { echo "[dev] mediamtx not at $MEDIAMTX_BIN" >&2; exit 1; }

# 1. MediaMTX
echo "[dev] starting mediamtx -> /tmp/mediamtx.log" >&2
"$MEDIAMTX_BIN" "$MEDIAMTX_CONFIG" >/tmp/mediamtx.log 2>&1 &
PIDS+=($!)
sleep 1

# 2. Webcam fan-out: one v4l2 input, split into 3 RTMP outputs at 15 fps to
#    keep all three encoders fed evenly (3x ultrafast at 30 fps starves cam2
#    on CPU-only AMD).
echo "[dev] fanning $WEBCAM into rtmp://localhost:1935/cam{1,2,3} -> /tmp/fanout.log" >&2
ffmpeg -hide_banner -loglevel warning \
  -f v4l2 -framerate 30 -video_size 1280x720 -i "$WEBCAM" \
  -filter_complex "[0:v]fps=15,split=3[v1][v2][v3]; \
                   [v1]crop=800:720:0:0[c1]; \
                   [v2]crop=800:720:480:0[c2]; \
                   [v3]copy[c3]" \
  -map "[c1]" -c:v libx264 -preset veryfast -tune zerolatency -crf 28 -g 30 -an -f flv rtmp://localhost:1935/cam1 \
  -map "[c2]" -c:v libx264 -preset veryfast -tune zerolatency -crf 28 -g 30 -an -f flv rtmp://localhost:1935/cam2 \
  -map "[c3]" -c:v libx264 -preset veryfast -tune zerolatency -crf 28 -g 30 -an -f flv rtmp://localhost:1935/cam3 \
  >/tmp/fanout.log 2>&1 &
PIDS+=($!)

sleep 2

# 3. Pre-warm YOLO in the launcher process to ensure yolov8n.pt and
#    yolov8n_openvino_model/ exist before workers spawn (they race on
#    download otherwise).
echo "[dev] pre-warming YOLO model in $AI_DIR" >&2
( cd "$AI_DIR" && "$PY" -c "
from tracker import Tracker
import time
t0 = time.time()
Tracker(model_path='yolov8n.pt', conf=0.20, device='openvino', imgsz=640)
print(f'  prewarm done in {time.time()-t0:.1f}s')
" ) >&2

# 4. Broadcast — runs from ai-service/ so all workers share that cwd and find
#    the model files there. Stdout discarded (no YouTube push).
echo "[dev] starting broadcast.py -> /tmp/broadcast.log" >&2
( cd "$AI_DIR" && "$PY" "$AI_DIR/broadcast.py" --config "$LV_DIR/cameras.yaml" \
  >/dev/null 2>/tmp/broadcast.log ) &
PIDS+=($!)

sleep 4
echo "" >&2
echo "[dev] ✓ all running. Open the dashboard:" >&2
echo "       http://127.0.0.1:8888/dashboard" >&2
echo "" >&2
echo "[dev] How to test (hold a tennis/soccer/basketball — YOLO COCO 'sports ball'):" >&2
echo "       - Ball on the LEFT side of webcam   → cam1 wins after ~0.8s" >&2
echo "       - Ball CENTERED                     → cam3 wins (most central in wide)" >&2
echo "       - Ball on the RIGHT side of webcam  → cam2 wins" >&2
echo "       - Ball out of frame                 → cam3 holds via role_bonus" >&2
echo "       - Hold ball CLOSE (10-15cm from cam) for best detection on yolov8n" >&2
echo "" >&2
echo "[dev] Polling /status (Ctrl-C to stop)..." >&2

while sleep 1; do
  if ! resp=$(curl -fsS http://127.0.0.1:8888/status 2>/dev/null); then
    echo "[dev] status_server not ready..."
    continue
  fi
  "$PY" - <<EOF
import json
s = json.loads('''$resp''')
cams = " ".join(
    f"{cid}:{c['ewma']:.2f}/fps{c['fps']:.0f}" for cid, c in sorted(s['cameras'].items())
)
print(f"current={s['current']:>4}  challenger={s.get('challenger') or '-':>4}  "
      f"ball_recent={str(s['global_ball_recent']):>5}  override={s.get('overridden') or '-':>4}  "
      f"[{cams}]")
EOF
done
