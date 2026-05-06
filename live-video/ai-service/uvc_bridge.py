"""
Bridge UVC (USB) cameras into MediaMTX as RTMP push streams.

Reads cameras.yaml and, for each camera with a `uvc_device` field, runs an
FFmpeg sidecar that captures the device and pushes RTMP to MediaMTX. Downstream
code only ever reads RTMP — single ingest abstraction regardless of whether
a given camera arrives via network push or USB.

Usage:
    python3 uvc_bridge.py --config /path/to/cameras.yaml

Lifecycle:
    - One subprocess per UVC camera.
    - Restarts a child if it exits non-zero (with backoff).
    - Clean shutdown on SIGINT/SIGTERM: terminates all children, waits, then exits.
"""
from __future__ import annotations

import argparse
import logging
import platform
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

log = logging.getLogger("uvc_bridge")


@dataclass
class UvcCamera:
    cam_id: str
    device: str
    ingest_url: str
    resolution: str = "1280x720"
    framerate: int = 30
    pixel_format: Optional[str] = None  # e.g. "mjpeg", "yuyv422"; None = auto-negotiate


def parse_uvc_cameras(config_path: Path) -> list[UvcCamera]:
    with config_path.open() as f:
        cfg = yaml.safe_load(f)
    out: list[UvcCamera] = []
    for cam in cfg.get("cameras", []):
        if not cam.get("enabled", True):
            continue
        device = cam.get("uvc_device")
        if not device:
            continue
        out.append(
            UvcCamera(
                cam_id=cam["id"],
                device=str(device),
                ingest_url=cam["ingest_url"],
                resolution=cam.get("uvc_resolution", "1280x720"),
                framerate=int(cam.get("uvc_framerate", 30)),
                pixel_format=cam.get("uvc_pixel_format"),
            )
        )
    return out


def build_ffmpeg_cmd(cam: UvcCamera) -> list[str]:
    """
    Returns the FFmpeg argv for capturing a UVC device and pushing RTMP.

    Platform-specific input format is selected from platform.system():
      - Linux: -f v4l2 -i /dev/videoX
      - Darwin: -f avfoundation -i "<index>:none"   (audio handled via audio_source)
      - Windows: -f dshow -i video="<friendly name>"
    """
    sysname = platform.system()
    base_in: list[str] = ["ffmpeg", "-hide_banner", "-loglevel", "warning"]

    if sysname == "Linux":
        base_in += ["-f", "v4l2", "-framerate", str(cam.framerate),
                    "-video_size", cam.resolution]
        if cam.pixel_format:
            base_in += ["-input_format", cam.pixel_format]
        base_in += ["-i", cam.device]
    elif sysname == "Darwin":
        base_in += ["-f", "avfoundation", "-framerate", str(cam.framerate),
                    "-video_size", cam.resolution]
        if cam.pixel_format:
            base_in += ["-pixel_format", cam.pixel_format]
        # avfoundation: "<video_index>:<audio_index>"; "none" disables audio.
        base_in += ["-i", f"{cam.device}:none"]
    elif sysname == "Windows":
        base_in += ["-f", "dshow", "-framerate", str(cam.framerate),
                    "-video_size", cam.resolution,
                    "-i", f"video={cam.device}"]
    else:
        raise RuntimeError(f"Unsupported platform for UVC bridge: {sysname}")

    encode_out: list[str] = [
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-pix_fmt", "yuv420p",
        "-g", str(cam.framerate * 2),
        "-an",
        "-f", "flv",
        cam.ingest_url,
    ]
    return base_in + encode_out


class BridgeSupervisor:
    """Spawns and restarts FFmpeg children, one per UVC camera."""

    INITIAL_BACKOFF_SEC = 1.0
    MAX_BACKOFF_SEC = 30.0

    def __init__(self, cameras: list[UvcCamera]):
        self.cameras = cameras
        self.procs: dict[str, subprocess.Popen] = {}
        self.backoff: dict[str, float] = {c.cam_id: self.INITIAL_BACKOFF_SEC for c in cameras}
        self.next_start: dict[str, float] = {c.cam_id: 0.0 for c in cameras}
        self._stopping = False

    def start(self, cam: UvcCamera) -> None:
        cmd = build_ffmpeg_cmd(cam)
        log.info("[%s] starting bridge: %s", cam.cam_id, " ".join(cmd))
        proc = subprocess.Popen(cmd)
        self.procs[cam.cam_id] = proc

    def stop_all(self) -> None:
        self._stopping = True
        for cam_id, proc in self.procs.items():
            if proc.poll() is None:
                log.info("[%s] terminating", cam_id)
                proc.terminate()
        deadline = time.monotonic() + 5.0
        for cam_id, proc in self.procs.items():
            remaining = max(0.0, deadline - time.monotonic())
            try:
                proc.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                log.warning("[%s] still alive after grace, killing", cam_id)
                proc.kill()

    def step(self, now: float) -> None:
        for cam in self.cameras:
            proc = self.procs.get(cam.cam_id)
            if proc is None:
                if now >= self.next_start[cam.cam_id]:
                    self.start(cam)
                continue
            ret = proc.poll()
            if ret is None:
                # healthy — reset backoff after 30s of uptime
                continue
            log.warning("[%s] ffmpeg exited rc=%s, scheduling restart", cam.cam_id, ret)
            del self.procs[cam.cam_id]
            self.next_start[cam.cam_id] = now + self.backoff[cam.cam_id]
            self.backoff[cam.cam_id] = min(self.backoff[cam.cam_id] * 2, self.MAX_BACKOFF_SEC)

    def run(self) -> int:
        signal.signal(signal.SIGINT, lambda *_: self.stop_all())
        signal.signal(signal.SIGTERM, lambda *_: self.stop_all())
        log.info("supervising %d UVC bridge(s)", len(self.cameras))
        try:
            while not self._stopping:
                self.step(time.monotonic())
                time.sleep(0.5)
        finally:
            self.stop_all()
        return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "cameras.yaml",
        help="Path to cameras.yaml",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=args.log_level,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
    )

    cameras = parse_uvc_cameras(args.config)
    if not cameras:
        log.info("no UVC cameras configured (no `uvc_device` set on any camera) — exiting")
        return 0

    return BridgeSupervisor(cameras).run()


if __name__ == "__main__":
    sys.exit(main())
