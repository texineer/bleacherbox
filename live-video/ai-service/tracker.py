"""
Player and ball detection + tracking using YOLOv8 with BoT-SORT.
"""
import logging
import os
import platform
from collections import deque
from pathlib import Path
from typing import Optional

import numpy as np
from ultralytics import YOLO

# COCO class IDs relevant to baseball
PERSON_CLASS = 0
BALL_CLASS = 32  # sports ball in COCO

log = logging.getLogger(__name__)


def detect_device() -> str:
    """
    Auto-detect the best inference backend for this host.

    Priority: cuda → mps → openvino (Intel CPU/iGPU with `openvino` installed)
    → cpu fallback.

    Returns one of: "cuda", "mps", "openvino", "cpu". The Tracker class
    interprets "openvino" by lazy-exporting the model to that format and
    running inference via the CPU device on the OpenVINO-backed graph.
    """
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception as e:
        log.debug("torch backend probe failed: %s", e)

    machine = platform.machine().lower()
    is_x86 = machine in ("x86_64", "amd64", "i386", "i686")
    if is_x86:
        try:
            import openvino  # noqa: F401
            return "openvino"
        except ImportError:
            pass

    return "cpu"


def _ensure_openvino_export(model_path: str) -> str:
    """
    Ensure an OpenVINO export of the given .pt model exists, returning the
    path to the exported directory (which YOLO() can load directly).
    """
    p = Path(model_path)
    if p.is_dir():
        return str(p)
    base = p.with_suffix("")
    ov_dir = Path(f"{base}_openvino_model")
    if ov_dir.exists():
        return str(ov_dir)
    log.info("exporting %s to OpenVINO at %s (one-time)", model_path, ov_dir)
    YOLO(model_path).export(format="openvino")
    return str(ov_dir)


class Detection:
    def __init__(self, track_id, cls, x1, y1, x2, y2, conf):
        self.track_id = int(track_id)
        self.cls = int(cls)
        self.x1, self.y1, self.x2, self.y2 = int(x1), int(y1), int(x2), int(y2)
        self.conf = float(conf)

    @property
    def center(self):
        return ((self.x1 + self.x2) // 2, (self.y1 + self.y2) // 2)

    @property
    def bbox(self):
        return (self.x1, self.y1, self.x2, self.y2)


class Tracker:
    def __init__(
        self,
        model_path: str = "yolov8n.pt",
        conf: float = 0.35,
        ball_trail_len: int = 20,
        device: Optional[str] = None,
        imgsz: Optional[int] = None,
    ):
        """
        device:
            None      -> auto-detect via detect_device()
            "cuda"    -> NVIDIA GPU
            "mps"     -> Apple Silicon
            "openvino"-> Intel CPU/iGPU; loads OpenVINO export, infers on "cpu"
            "cpu"     -> torch CPU fallback
        imgsz: optional inference resolution override (e.g. 640 to speed up).
        """
        if device is None:
            device = detect_device()
        self.device = device
        self.conf = conf
        self.imgsz = imgsz

        if device == "openvino":
            ov_path = _ensure_openvino_export(model_path)
            self.model = YOLO(ov_path, task="detect")
            # OpenVINO graphs run on "cpu" from torch's perspective.
            self._track_device = "cpu"
        else:
            self.model = YOLO(model_path)
            self._track_device = device

        # Rolling trail for ball positions: deque of (cx, cy, age)
        self.ball_trail = deque(maxlen=ball_trail_len)

    def process_frame(self, frame):
        """
        Run YOLO tracking on a frame.
        Returns (players: list[Detection], ball: Detection|None)
        """
        track_kwargs = dict(
            persist=True,
            conf=self.conf,
            classes=[PERSON_CLASS, BALL_CLASS],
            tracker="botsort.yaml",
            verbose=False,
            device=self._track_device,
        )
        if self.imgsz:
            track_kwargs["imgsz"] = self.imgsz
        results = self.model.track(frame, **track_kwargs)

        players = []
        ball = None

        if results and results[0].boxes is not None:
            boxes = results[0].boxes
            for box in boxes:
                if box.id is None:
                    continue
                cls = int(box.cls[0])
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0])
                track_id = int(box.id[0])
                det = Detection(track_id, cls, x1, y1, x2, y2, conf)

                if cls == PERSON_CLASS:
                    players.append(det)
                elif cls == BALL_CLASS:
                    # Keep highest-confidence ball detection
                    if ball is None or conf > ball.conf:
                        ball = det

        # Update ball trail
        if ball is not None:
            self.ball_trail.append(ball.center)

        return players, ball

    def get_ball_trail(self):
        """Returns list of (x, y) positions, oldest first."""
        return list(self.ball_trail)

    def clear_ball_trail(self):
        self.ball_trail.clear()
