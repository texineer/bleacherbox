"""
Loader for live-video/cameras.yaml. Centralizes all dataclasses so other
modules import typed configs instead of dict-walking yaml.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml


@dataclass
class CameraConfig:
    id: str
    name: str
    role: str
    ingest_url: str
    enabled: bool = True
    calibration: Optional[str] = None
    uvc_device: Optional[str] = None
    uvc_resolution: str = "1280x720"
    uvc_framerate: int = 30
    uvc_pixel_format: Optional[str] = None


@dataclass
class DirectorPolicy:
    switch_threshold: float = 0.15
    dwell_seconds: float = 1.5
    ewma_alpha: float = 0.35
    no_ball_default_role: str = "wide"
    no_ball_grace_seconds: float = 5.0


@dataclass
class ScoreWeights:
    ball_visible: float = 0.40
    ball_centrality: float = 0.20
    ball_size: float = 0.15
    player_density: float = 0.15
    role_bonus: float = 0.10


@dataclass
class DirectorConfig:
    policy: DirectorPolicy = field(default_factory=DirectorPolicy)
    weights: ScoreWeights = field(default_factory=ScoreWeights)


@dataclass
class MediaMTXConfig:
    binary: str = "/opt/mediamtx/mediamtx"
    config: str = "live-video/mediamtx/mediamtx.yml"
    rtmp_port: int = 1935
    rtsp_port: int = 8554
    api_port: int = 9997


@dataclass
class InferenceConfig:
    model: str = "yolov8n.pt"
    conf: float = 0.35
    imgsz: int = 1280
    device: str = "auto"   # auto | cuda | mps | openvino | cpu


@dataclass
class OutputConfig:
    width: int = 1280
    height: int = 720
    fps: int = 30
    bitrate: str = "4500k"


@dataclass
class StatusServerConfig:
    host: str = "127.0.0.1"
    port: int = 8888


@dataclass
class FleetConfig:
    cameras: list[CameraConfig]
    director: DirectorConfig
    audio_source: str
    mediamtx: MediaMTXConfig
    inference: InferenceConfig
    output: OutputConfig
    status_server: StatusServerConfig
    config_path: Path

    def cam(self, cam_id: str) -> CameraConfig:
        for c in self.cameras:
            if c.id == cam_id:
                return c
        raise KeyError(f"unknown camera id: {cam_id}")

    @property
    def enabled_cameras(self) -> list[CameraConfig]:
        return [c for c in self.cameras if c.enabled]


def _build_camera(d: dict) -> CameraConfig:
    return CameraConfig(
        id=d["id"],
        name=d["name"],
        role=d["role"],
        ingest_url=d["ingest_url"],
        enabled=d.get("enabled", True),
        calibration=d.get("calibration"),
        uvc_device=str(d["uvc_device"]) if d.get("uvc_device") is not None else None,
        uvc_resolution=d.get("uvc_resolution", "1280x720"),
        uvc_framerate=int(d.get("uvc_framerate", 30)),
        uvc_pixel_format=d.get("uvc_pixel_format"),
    )


def load_config(path: Path | str) -> FleetConfig:
    path = Path(path)
    with path.open() as f:
        raw = yaml.safe_load(f)

    cameras = [_build_camera(c) for c in raw["cameras"]]
    if not cameras:
        raise ValueError(f"{path}: no cameras configured")

    pol_raw = raw.get("director", {}).get("policy", {})
    weights_raw = raw.get("director", {}).get("weights", {})
    director = DirectorConfig(
        policy=DirectorPolicy(**pol_raw),
        weights=ScoreWeights(**weights_raw),
    )

    cfg = FleetConfig(
        cameras=cameras,
        director=director,
        audio_source=raw.get("audio_source", cameras[0].id),
        mediamtx=MediaMTXConfig(**raw.get("mediamtx", {})),
        inference=InferenceConfig(**raw.get("inference", {})),
        output=OutputConfig(**raw.get("output", {})),
        status_server=StatusServerConfig(**raw.get("status_server", {})),
        config_path=path,
    )

    # Sanity: audio_source must reference a real cam.
    try:
        cfg.cam(cfg.audio_source)
    except KeyError as e:
        raise ValueError(f"audio_source {cfg.audio_source!r} does not match any camera id") from e

    return cfg
