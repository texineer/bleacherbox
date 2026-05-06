"""
Per-camera worker process. One process per enabled camera.

Pipeline inside one worker:
  1. cv2.VideoCapture(ingest_url, cv2.CAP_FFMPEG) with retry-on-failure
  2. resize to output dims (frame_bus is fixed-size)
  3. Tracker.process_frame -> players, ball
  4. overlay.draw_frame in-place
  5. FrameWriter.write -> shared memory slab
  6. push ScoreEvent onto score_queue (Phase B: placeholder; Phase C: real scoring)

Workers are entirely event-loop free — they just chase the camera's frame rate.
The director throttles output downstream by reading the latest slab.
"""
from __future__ import annotations

import logging
import multiprocessing as mp
import os
import time
from typing import Optional

# NOTE: heavy imports (cv2, ultralytics) deliberately deferred to run() so the
# parent process doesn't pay for them.

from config import CameraConfig, DirectorPolicy, InferenceConfig, OutputConfig
from frame_bus import CameraSlab
from scoring import ScoreEvent, compute_components


class CameraWorker(mp.Process):
    """
    Spawned by broadcast.py per enabled camera.

    Args mirror the FleetConfig pieces this worker needs. Passed via __init__
    rather than via shared globals so spawn-mode multiprocessing works (macOS).
    """

    RECONNECT_BACKOFF_INITIAL = 1.0
    RECONNECT_BACKOFF_MAX = 30.0

    def __init__(
        self,
        cam_cfg: CameraConfig,
        slab: CameraSlab,
        score_queue: mp.Queue,
        inference: InferenceConfig,
        output: OutputConfig,
        policy: DirectorPolicy,
        calibration_dir: str,
        log_level: str = "INFO",
    ):
        super().__init__(name=f"cam-{cam_cfg.id}", daemon=False)
        self.cam_cfg = cam_cfg
        self.slab = slab
        self.score_queue = score_queue
        self.inference = inference
        self.output = output
        self.policy = policy
        self.calibration_dir = calibration_dir
        self.log_level = log_level

    # ------------------- child process entrypoint -------------------

    def run(self) -> None:  # type: ignore[override]
        logging.basicConfig(
            level=self.log_level,
            format=f"%(asctime)s cam-{self.cam_cfg.id} %(levelname)s: %(message)s",
        )
        log = logging.getLogger(f"cam-{self.cam_cfg.id}")

        # Heavy imports
        import cv2
        import numpy as np
        from frame_bus import FrameWriter
        from tracker import Tracker
        from overlay import draw_frame, load_calibration

        device = self._resolve_device()
        log.info("init Tracker model=%s conf=%.2f device=%s",
                 self.inference.model, self.inference.conf, device)
        tracker = Tracker(
            model_path=self.inference.model,
            conf=self.inference.conf,
            device=device,
        )

        calib = None
        if self.cam_cfg.calibration:
            calib_path = os.path.join(self.calibration_dir, self.cam_cfg.calibration)
            calib = load_calibration(calib_path)
            log.info("loaded calibration: %s (%s)", calib_path, "yes" if calib else "missing")

        writer = FrameWriter(self.slab)

        backoff = self.RECONNECT_BACKOFF_INITIAL
        cap = None
        out_h, out_w = self.output.height, self.output.width
        frame_count = 0
        fps_window_start = time.monotonic()
        fps_window_frames = 0
        rolling_fps = 0.0

        try:
            while True:
                if cap is None or not cap.isOpened():
                    cap = self._open_capture(cv2)
                    if cap is None:
                        log.warning("ingest unavailable, retry in %.1fs", backoff)
                        time.sleep(backoff)
                        backoff = min(backoff * 2, self.RECONNECT_BACKOFF_MAX)
                        continue
                    backoff = self.RECONNECT_BACKOFF_INITIAL
                    log.info("opened %s", self.cam_cfg.ingest_url)

                ok, frame = cap.read()
                if not ok or frame is None:
                    log.warning("read failed, reconnecting")
                    cap.release()
                    cap = None
                    continue

                if frame.shape[:2] != (out_h, out_w):
                    frame = cv2.resize(frame, (out_w, out_h), interpolation=cv2.INTER_LINEAR)

                players, ball = tracker.process_frame(frame)
                trail = tracker.get_ball_trail()
                draw_frame(frame, players, ball, trail, calib)

                writer.write(frame)
                frame_count += 1

                # rolling fps over 1s window
                fps_window_frames += 1
                now = time.monotonic()
                elapsed = now - fps_window_start
                if elapsed >= 1.0:
                    rolling_fps = fps_window_frames / elapsed
                    fps_window_start = now
                    fps_window_frames = 0

                # Compute raw components (cam-local, no global awareness).
                components = compute_components(
                    self.cam_cfg, players, ball, frame.shape,
                    default_role=self.policy.no_ball_default_role,
                )
                self._emit_score(now, components, players, ball, rolling_fps)
        finally:
            if cap is not None:
                cap.release()
            writer.close()

    # ------------------- helpers -------------------

    def _open_capture(self, cv2_mod):
        # Prefer the FFmpeg backend explicitly; OpenCV otherwise picks at random
        # (e.g. GStreamer on Linux, AVFoundation on macOS).
        cap_ffmpeg = getattr(cv2_mod, "CAP_FFMPEG", 1900)
        cap = cv2_mod.VideoCapture(self.cam_cfg.ingest_url, cap_ffmpeg)
        if not cap.isOpened():
            try:
                cap.release()
            except Exception:
                pass
            return None
        try:
            cap.set(cv2_mod.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        return cap

    def _resolve_device(self) -> str:
        configured = (self.inference.device or "auto").lower()
        if configured != "auto":
            return configured
        from tracker import detect_device
        return detect_device()

    def _emit_score(self, now: float, components, players, ball, fps: float) -> None:
        try:
            self.score_queue.put_nowait(
                ScoreEvent(
                    cam_id=self.cam_cfg.id,
                    ts=now,
                    fps=fps,
                    components=components,
                    detections={"players": len(players), "ball_seen": ball is not None},
                )
            )
        except Exception:
            # queue full — drop the event; director only cares about latest
            pass
