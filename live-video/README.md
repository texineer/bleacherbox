# BleacherBox Live Video — AI Broadcast Module

Standalone module for streaming a baseball game to YouTube Live with real-time AI overlays:
- **Player tracking** — bounding boxes + persistent IDs
- **Ball detection** — position + fading trail arc
- **Strike zone** — calibrated rectangle over home plate

Runs on a Mac Mini M4 at the field (or this LXC container for testing).

---

## Two parts

| Folder | What it is | Status |
|---|---|---|
| [`field-rig/`](field-rig/README.md) | **Game-day streaming**: Mevo + NearStream cameras → MediaMTX relay → OBS (strike zone overlay) → GameChanger over Starlink, with pre-game health checks, an in-game network monitor and post-game reports | In use at games |
| `ai-service/`, `stream/` (this README) | **AI broadcast overlays**: YOLO player/ball tracking and strike zone, piped to YouTube | Experimental |

They connect through the field rig's relay: it records every camera raw (`Videos\Baseball\raw`) and
serves each feed at `rtsp://127.0.0.1:8554/<camera>`, so the AI service can read the same feeds
(`main.py --input rtsp://127.0.0.1:8554/live/mevo1`) or be tuned on recorded footage, without touching the live stream.

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

## File Structure

```
live-video/
├── README.md                  ← this file
├── ai-service/
│   ├── main.py                ← entry point, frame pipeline
│   ├── tracker.py             ← YOLOv8 + BoT-SORT detection/tracking
│   ├── overlay.py             ← draw bounding boxes, trail, strike zone
│   ├── calibration.py         ← field calibration (click plate corners)
│   ├── requirements.txt       ← Python dependencies
│   └── calibration.json       ← generated after running calibration.py
└── stream/
    └── stream.sh              ← FFmpeg pipe → YouTube RTMP
```
