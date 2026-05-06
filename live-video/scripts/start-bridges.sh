#!/usr/bin/env bash
# Launch UVC → MediaMTX bridges for any camera in cameras.yaml that has uvc_device set.
# Exits cleanly on SIGINT/SIGTERM.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LV_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
exec python3 "$LV_DIR/ai-service/uvc_bridge.py" --config "$LV_DIR/cameras.yaml" "$@"
