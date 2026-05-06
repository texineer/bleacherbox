"""
Director: consumes ScoreEvents from camera workers, picks the broadcast
camera each tick using EWMA-smoothed scores plus a hysteresis policy.

State machine:
    current      = camera currently on-air
    challenger   = camera with the highest aggregate that exceeds current's
                   by switch_threshold; None if no qualified challenger
    challenger_since = timestamp the current challenger first qualified

Switching only happens when `challenger` has been the same camera and beating
`current` by threshold for at least `dwell_seconds`. This rejects transient
spikes (e.g. a brief false-positive ball detection on an off-action cam).

Director also tracks `global_last_ball_ts` so it can decide whether the
role bonus is active this tick (any cam saw a ball recently → no bonus;
silence for > no_ball_grace_seconds → bonus active for default-role cam).
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Optional

from config import DirectorConfig
from scoring import ScoreComponents, ScoreEvent, aggregate

log = logging.getLogger(__name__)


@dataclass
class CameraState:
    cam_id: str
    role: str
    ewma: float = 0.0
    last_components: Optional[ScoreComponents] = None
    last_breakdown: dict = field(default_factory=dict)
    last_ts: float = 0.0
    last_fps: float = 0.0
    last_detections: dict = field(default_factory=dict)
    initialized: bool = False


@dataclass
class DirectorSnapshot:
    """Read-only view exposed to status_server / dashboards."""
    current: str
    challenger: Optional[str]
    challenger_since: Optional[float]
    global_ball_recent: bool
    cameras: dict   # cam_id -> {ewma, fps, breakdown, detections}
    overridden: Optional[str] = None


class Director:
    def __init__(
        self,
        cfg: DirectorConfig,
        cam_id_to_role: dict[str, str],
        initial_cam: str,
    ):
        self.cfg = cfg
        self.cams: dict[str, CameraState] = {
            cid: CameraState(cam_id=cid, role=role) for cid, role in cam_id_to_role.items()
        }
        self.current: str = initial_cam
        self.challenger: Optional[str] = None
        self.challenger_since: Optional[float] = None
        # Last time any camera reported ball_visible. None == never seen.
        self.global_last_ball_ts: Optional[float] = None
        self._override: Optional[str] = None

    # ------------------- override (dashboard pin) -------------------
    def set_override(self, cam_id: Optional[str]) -> None:
        if cam_id is not None and cam_id not in self.cams:
            raise KeyError(f"unknown cam_id {cam_id!r}")
        self._override = cam_id
        if cam_id is not None:
            self.current = cam_id
            self.challenger = None
            self.challenger_since = None

    @property
    def overridden(self) -> Optional[str]:
        return self._override

    # ------------------- main loop call -------------------
    def consume(self, events: list[ScoreEvent], now: Optional[float] = None) -> str:
        """
        Update internal state from a batch of score events; return current
        broadcast camera id. Safe to call with an empty list.
        """
        if now is None:
            now = time.monotonic()

        weights = self.cfg.weights
        policy = self.cfg.policy

        # Pre-pass: update global_last_ball_ts before computing role_bonus_active,
        # so a fresh ball detection THIS TICK suppresses the bonus immediately.
        for ev in events:
            if ev.components.ball_visible >= 0.5:
                if self.global_last_ball_ts is None or ev.ts > self.global_last_ball_ts:
                    self.global_last_ball_ts = ev.ts

        if self.global_last_ball_ts is None:
            time_since_ball = float("inf")
        else:
            time_since_ball = now - self.global_last_ball_ts
        role_bonus_active = time_since_ball >= policy.no_ball_grace_seconds

        # Per-event: aggregate -> EWMA update.
        for ev in events:
            cam = self.cams.get(ev.cam_id)
            if cam is None:
                continue
            score, breakdown = aggregate(ev.components, weights, role_bonus_active)
            if not cam.initialized:
                cam.ewma = score
                cam.initialized = True
            else:
                a = policy.ewma_alpha
                cam.ewma = a * score + (1 - a) * cam.ewma
            cam.last_components = ev.components
            cam.last_breakdown = breakdown
            cam.last_ts = ev.ts
            cam.last_fps = ev.fps
            cam.last_detections = ev.detections

        # If overridden, skip switching logic.
        if self._override is not None:
            self.current = self._override
            self.challenger = None
            self.challenger_since = None
            return self.current

        # Pick best initialized camera.
        initialized = [c for c in self.cams.values() if c.initialized]
        if not initialized:
            return self.current

        best = max(initialized, key=lambda c: c.ewma)
        cur = self.cams[self.current]

        # If best is current, clear challenger and we're done.
        if best.cam_id == self.current:
            self.challenger = None
            self.challenger_since = None
            return self.current

        # Best must beat current by threshold.
        if best.ewma - cur.ewma < policy.switch_threshold:
            self.challenger = None
            self.challenger_since = None
            return self.current

        # Begin or continue challenge.
        if self.challenger != best.cam_id:
            self.challenger = best.cam_id
            self.challenger_since = now
            log.info(
                "director: challenger=%s ewma=%.3f vs current=%s ewma=%.3f Δ=%.3f",
                best.cam_id, best.ewma, self.current, cur.ewma, best.ewma - cur.ewma,
            )
            return self.current

        # Sustained for dwell seconds? challenger_since is always set whenever
        # challenger is set, so direct subtraction is safe.
        assert self.challenger_since is not None
        elapsed = now - self.challenger_since
        if elapsed >= policy.dwell_seconds:
            log.info(
                "director: switch %s -> %s after %.2fs (Δ=%.3f)",
                self.current, self.challenger, elapsed, best.ewma - cur.ewma,
            )
            self.current = self.challenger
            self.challenger = None
            self.challenger_since = None

        return self.current

    # ------------------- read-only snapshot -------------------
    def snapshot(self) -> DirectorSnapshot:
        now = time.monotonic()
        if self.global_last_ball_ts is None:
            time_since_ball = float("inf")
        else:
            time_since_ball = now - self.global_last_ball_ts
        return DirectorSnapshot(
            current=self.current,
            challenger=self.challenger,
            challenger_since=self.challenger_since,
            global_ball_recent=time_since_ball < self.cfg.policy.no_ball_grace_seconds,
            cameras={
                cid: {
                    "ewma": c.ewma,
                    "fps": c.last_fps,
                    "breakdown": c.last_breakdown,
                    "detections": c.last_detections,
                    "ts": c.last_ts,
                    "role": c.role,
                }
                for cid, c in self.cams.items()
            },
            overridden=self._override,
        )
