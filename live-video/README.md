# BleacherBox Live Video — AI Broadcast Module

Standalone module for streaming a baseball game to YouTube Live with real-time AI overlays:
- **Player tracking** — bounding boxes + persistent IDs
- **Ball detection** — position + fading trail arc
- **Strike zone** — calibrated rectangle over home plate

Runs on a Mac Mini M4 at the field (or this LXC container for testing).

---

## Architecture

```
Camera (/dev/video0 or .mp4)
    ↓
python main.py
├── OpenCV reads frames
├── YOLOv8n: detect persons + sports-ball
├── BoT-SORT: persistent player track IDs
└── draw overlays → pipe raw BGR to stdout
    ↓
FFmpeg → H.264 encode → RTMP → YouTube Live
```

---

## LXC / VM Setup (Ubuntu 24.04)

### 1. System dependencies (already installed on bleacherbox-video LXC)
```bash
apt update && apt install -y python3 python3-pip ffmpeg git libgl1 build-essential
```

### 2. Clone the repo
```bash
git clone https://github.com/your-org/bleacherbox.git /opt/bleacherbox
# or copy just the live-video folder:
# scp -r ./live-video root@172.30.10.117:/opt/bleacherbox-video
```

### 3. Install Python AI dependencies
```bash
cd /opt/bleacherbox-video/ai-service
pip3 install -r requirements.txt
```

This downloads ~500MB (PyTorch + ultralytics). First run will also download `yolov8n.pt` (~6MB).

### 4. Pre-download YOLO weights (optional, avoids delay on first stream)
```bash
python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
```

---

## Field Calibration (strike zone)

Run once at the field before streaming. You need a display for this step.

```bash
cd /opt/bleacherbox-video/ai-service
python3 calibration.py --input /dev/video0
```

A window opens showing the camera feed. **Click the 4 corners of the strike zone** (top-left → top-right → bottom-right → bottom-left of home plate area). Press `s` to save, `r` to reset, `q` to quit.

Saves `calibration.json` in the same directory. The main pipeline loads it automatically.

---

## Running the Stream

### Quick start (YouTube Live)
```bash
cd /opt/bleacherbox-video/stream
./stream.sh YOUR_STREAM_KEY
```

Get your stream key from [YouTube Studio → Go Live → Stream](https://studio.youtube.com/).

### With a specific camera device
```bash
./stream.sh YOUR_STREAM_KEY /dev/video1
```

### Test with a video file (no YouTube, saves to file)
```bash
cd /opt/bleacherbox-video/ai-service
python3 main.py --input game_footage.mp4 --output test_out.mp4
```

### Test with display window
```bash
python3 main.py --input game_footage.mp4 --display
```

### Full manual pipe command
```bash
python3 main.py --input /dev/video0 | \
  ffmpeg -f rawvideo -pix_fmt bgr24 -s 1280x720 -r 30 -i pipe:0 \
    -c:v libx264 -preset veryfast -tune zerolatency \
    -b:v 4500k -f flv rtmp://a.rtmp.youtube.com/live2/YOUR_STREAM_KEY
```

---

## Camera Setup

### Mevo Start / Mevo Plus
1. Connect to the Mevo app on phone
2. Enable USB streaming mode (Settings → USB Mode)
3. Connect USB-C to Mac Mini / LXC host
4. Camera appears as `/dev/video0`

### GoPro (Hero 10+)
1. Enable Webcam mode (Connections → USB Control → GoPro Webcam)
2. Connect USB-C to Mac Mini
3. Camera appears as `/dev/video0`
4. Optional: use GoPro Webcam app to configure resolution

### OBS (Mac Mini)
If using OBS as a virtual camera:
1. Configure OBS scene with overlays
2. Enable Virtual Camera in OBS
3. Use the virtual camera as input: `--input "OBS Virtual Camera"`

---

## AI Model Options

| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| `yolov8n.pt` | 6MB | ~60fps (CPU) | Good for persons |
| `yolov8s.pt` | 22MB | ~30fps (CPU) | Better ball detection |
| `yolov8m.pt` | 52MB | ~15fps (CPU) | Best, needs GPU |

Set with `--model yolov8s.pt` in `stream.sh` or `main.py`.

On Mac Mini M4 with MPS (Metal) acceleration, `yolov8s` runs at real-time speed.

---

## Troubleshooting

**No ball detected:** Baseball is small and fast. YOLO misses many pitches but catches most fielding plays. Use `yolov8s.pt` for better detection.

**Strike zone missing:** Run `calibration.py` first to generate `calibration.json`.

**Stream lag:** Reduce `--conf` threshold (e.g., `0.25`) to speed up inference, or use `yolov8n.pt`.

**Camera not found:** List devices with `ls /dev/video*`. Try index `0`, `1`, `2`.

**FFmpeg RTMP error:** Verify stream key in YouTube Studio → Go Live is active.

---

## Multi-Camera Auto-Director (MODE=multicam)

Single-camera mode (everything above) is the legacy `main.py` path. The
multicam mode runs an auto-director: ingest from any number of cameras,
score "where the action is" per camera with YOLO, and switch the broadcast
output to whichever camera has the best view of the play.

### Architecture

```
[Mevo / GoPro / Phone / RTSP cam] ──RTMP push──┐
[GoPro Webcam mode / OBS Virtual Cam] ─bridge──┼──► MediaMTX (rtmp://localhost:1935/camN)
                                                       │
                                          ┌────────────┴────────────┐
                                          │  N CameraWorker procs   │
                                          │  read RTMP → YOLO →     │
                                          │  overlay → frame slab + │
                                          │  ScoreEvent             │
                                          └────────────┬────────────┘
                                                       ▼
                                              Director (hysteresis)
                                                       ▼
                                       selected slab → stdout BGR
                                                       ▼
                                              ffmpeg → RTMP YouTube
```

### Setup

1. **Install MediaMTX** from https://github.com/bluenviron/mediamtx (single
   binary). Drop it at `/opt/mediamtx/mediamtx`.
2. **Edit `cameras.yaml`** to describe your fleet (id, name, role, ingest_url,
   optional `uvc_device` for USB cameras). Default file ships with three
   example cameras.
3. **Install Python deps** (same `pip3 install -r ai-service/requirements.txt`).
4. **(Optional) Bridge USB cameras** for any camera that doesn't push RTMP
   natively (e.g. GoPro Webcam mode, OBS Virtual Cam):
   ```bash
   ./scripts/start-bridges.sh &
   ```
   This auto-launches an FFmpeg sidecar per camera with `uvc_device` set,
   pushing to MediaMTX.

### Per-camera calibration

```bash
python3 ai-service/calibration.py --input rtmp://localhost:1935/cam1 --camera-id cam1
python3 ai-service/calibration.py --input rtmp://localhost:1935/cam2 --camera-id cam2
```

Each writes `calibration.<id>.json` and is picked up automatically by the
worker for that camera (referenced from `cameras.yaml`).

### Run the broadcast

```bash
# 1. Start MediaMTX
/opt/mediamtx/mediamtx live-video/mediamtx/mediamtx.yml &

# 2. Push from your cameras to rtmp://<this-host>:1935/cam1, /cam2, /cam3, ...
#    (Mevo: settings → Streaming → RTMP. iPhone: Larix Broadcaster.
#    GoPro Webcam mode: handled by start-bridges.sh.)

# 3. Confirm cameras are publishing
ffplay rtsp://localhost:8554/cam1   # ESC to exit

# 4. Run the auto-director and push to YouTube
MODE=multicam ./stream/stream.sh YOUR_STREAM_KEY
```

### Dashboard

While `MODE=multicam` is running, open http://localhost:8888/dashboard
to see live per-camera scores, the current selection, and live thumbnails.
Pin a camera (override) by clicking its `pin` button.

### Tuning

Edit `cameras.yaml` `director.policy`:
- `switch_threshold` — challenger must beat current by this on a 0..1 scale
  before being eligible (default 0.15).
- `dwell_seconds` — sustained for this long before cutting (default 1.5s).
  Raise to suppress chatter, lower for snappier cuts.
- `ewma_alpha` — score smoothing (default 0.35).
- `no_ball_default_role` — which role to fall back to when no camera sees
  the ball (default `wide`).

### Audio

The broadcast muxes audio from `audio_source` in `cameras.yaml` (default
`cam1`). Set `WITH_AUDIO=0` on the `stream.sh` invocation to fall back to a
silent track (anullsrc) — useful if your audio source camera isn't
publishing yet.

### Hardware-agnostic inference

`Tracker` auto-detects the best YOLO backend at startup:
**CUDA → MPS (Apple Silicon) → OpenVINO (Intel CPU/iGPU) → CPU**.
Set `inference.device` in `cameras.yaml` to override.

---

## File Structure

```
live-video/
├── README.md                  ← this file
├── cameras.yaml               ← multicam fleet config
├── mediamtx/
│   └── mediamtx.yml           ← ingest server config
├── ai-service/
│   ├── main.py                ← legacy single-cam pipeline
│   ├── broadcast.py           ← multicam entrypoint (MODE=multicam)
│   ├── camera_worker.py       ← per-cam YOLO + overlay process
│   ├── director.py            ← EWMA + hysteresis switching
│   ├── scoring.py             ← per-frame action score
│   ├── frame_bus.py           ← shared-memory frame slabs
│   ├── config.py              ← cameras.yaml loader
│   ├── status_server.py       ← FastAPI dashboard on :8888
│   ├── uvc_bridge.py          ← UVC → RTMP supervisor
│   ├── tracker.py             ← YOLOv8 + BoT-SORT (auto device detect)
│   ├── overlay.py             ← bounding boxes, trail, strike zone
│   ├── calibration.py         ← field calibration (--camera-id for multicam)
│   ├── test_scoring.py        ← unit tests for scoring
│   ├── test_director.py       ← unit tests for director
│   └── requirements.txt       ← Python dependencies
├── scripts/
│   └── start-bridges.sh       ← launch UVC bridges per cameras.yaml
└── stream/
    └── stream.sh              ← FFmpeg pipe → YouTube RTMP (MODE=single|multicam)
```
