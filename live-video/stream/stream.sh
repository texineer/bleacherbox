#!/usr/bin/env bash
# BleacherBox Live — stream AI-processed video to YouTube Live
#
# Two modes:
#
#   MODE=single (default) — single-camera, legacy ai-service/main.py path
#     Usage: ./stream.sh STREAM_KEY [INPUT]
#
#   MODE=multicam — multi-camera auto-director (ai-service/broadcast.py)
#     Reads live-video/cameras.yaml. INPUT arg is ignored.
#     Usage: MODE=multicam ./stream.sh STREAM_KEY
#
# Examples:
#   ./stream.sh abc123-xyz-456
#   ./stream.sh abc123-xyz-456 /dev/video1
#   ./stream.sh abc123-xyz-456 game_footage.mp4
#   MODE=multicam ./stream.sh abc123-xyz-456
#
# Requirements: python3, ffmpeg, AI deps (pip install -r ../ai-service/requirements.txt).
# For MODE=multicam: MediaMTX must be running and cameras must be publishing.

set -euo pipefail

STREAM_KEY="${1:-}"
INPUT="${2:-/dev/video0}"
MODE="${MODE:-single}"
WIDTH="${WIDTH:-1280}"
HEIGHT="${HEIGHT:-720}"
FPS="${FPS:-30}"
BITRATE="${BITRATE:-4500k}"
RTMP_URL="${RTMP_URL:-rtmp://a.rtmp.youtube.com/live2}"

if [[ -z "$STREAM_KEY" ]]; then
  echo "Usage: $0 STREAM_KEY [INPUT_DEVICE_OR_FILE]" >&2
  echo "       MODE=multicam $0 STREAM_KEY" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LV_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
AI_DIR="$LV_DIR/ai-service"
CAMERAS_YAML="$LV_DIR/cameras.yaml"

ffmpeg_encode_video_only() {
  # legacy single-mode path: video stdin -> RTMP, no audio.
  ffmpeg \
    -f rawvideo -pix_fmt bgr24 -s "${WIDTH}x${HEIGHT}" -r "$FPS" -i pipe:0 \
    -c:v libx264 -preset veryfast -tune zerolatency \
    -b:v "$BITRATE" -maxrate "$BITRATE" -bufsize 9000k \
    -pix_fmt yuv420p -g $((FPS * 2)) \
    -f flv "${RTMP_URL}/${STREAM_KEY}"
}

ffmpeg_encode_with_audio() {
  # multicam path: video stdin + audio from a second RTMP input -> RTMP.
  # If the audio source isn't ready (e.g. no camera publishing the audio_source
  # path yet), FFmpeg will fail; user can set WITH_AUDIO=0 to fall back silent.
  local audio_url="$1"
  ffmpeg \
    -f rawvideo -pix_fmt bgr24 -s "${WIDTH}x${HEIGHT}" -r "$FPS" -i pipe:0 \
    -i "$audio_url" \
    -map 0:v -map 1:a \
    -c:v libx264 -preset veryfast -tune zerolatency \
    -b:v "$BITRATE" -maxrate "$BITRATE" -bufsize 9000k \
    -pix_fmt yuv420p -g $((FPS * 2)) \
    -c:a aac -b:a 128k -ar 44100 \
    -shortest \
    -f flv "${RTMP_URL}/${STREAM_KEY}"
}

ffmpeg_encode_silent() {
  # multicam fallback: anullsrc so YouTube has an audio track to accept the stream.
  ffmpeg \
    -f rawvideo -pix_fmt bgr24 -s "${WIDTH}x${HEIGHT}" -r "$FPS" -i pipe:0 \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100" \
    -map 0:v -map 1:a \
    -c:v libx264 -preset veryfast -tune zerolatency \
    -b:v "$BITRATE" -maxrate "$BITRATE" -bufsize 9000k \
    -pix_fmt yuv420p -g $((FPS * 2)) \
    -c:a aac -b:a 128k -ar 44100 \
    -shortest \
    -f flv "${RTMP_URL}/${STREAM_KEY}"
}

resolve_audio_url() {
  python3 - <<EOF
import sys
sys.path.insert(0, "$AI_DIR")
from config import load_config
cfg = load_config("$CAMERAS_YAML")
print(cfg.cam(cfg.audio_source).ingest_url)
EOF
}

case "$MODE" in
  single)
    LOOP_FLAG=""
    if [[ "$INPUT" != /dev/* ]]; then
      LOOP_FLAG="--loop"
      echo "[stream] Video file detected — will loop continuously" >&2
    fi
    echo "[stream] mode=single input=$INPUT res=${WIDTH}x${HEIGHT}@${FPS}" >&2
    python3 "$AI_DIR/main.py" \
      --input "$INPUT" \
      --width "$WIDTH" \
      --height "$HEIGHT" \
      --fps "$FPS" \
      $LOOP_FLAG \
      | ffmpeg_encode_video_only
    ;;

  multicam)
    if [[ ! -f "$CAMERAS_YAML" ]]; then
      echo "[stream] cameras.yaml not found at $CAMERAS_YAML" >&2
      exit 1
    fi
    WITH_AUDIO="${WITH_AUDIO:-1}"
    echo "[stream] mode=multicam config=$CAMERAS_YAML res=${WIDTH}x${HEIGHT}@${FPS} with_audio=$WITH_AUDIO" >&2
    if [[ "$WITH_AUDIO" == "1" ]]; then
      AUDIO_URL="$(resolve_audio_url)"
      echo "[stream] audio source: $AUDIO_URL" >&2
      python3 "$AI_DIR/broadcast.py" --config "$CAMERAS_YAML" \
        | ffmpeg_encode_with_audio "$AUDIO_URL"
    else
      echo "[stream] audio: silent (anullsrc) — set WITH_AUDIO=1 to mux audio_source" >&2
      python3 "$AI_DIR/broadcast.py" --config "$CAMERAS_YAML" \
        | ffmpeg_encode_silent
    fi
    ;;

  *)
    echo "[stream] unknown MODE=$MODE (expected 'single' or 'multicam')" >&2
    exit 1
    ;;
esac
