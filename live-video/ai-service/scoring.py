"""
Per-camera "action score" — how well does this camera see the play right now?

Two-stage design:
  1. Workers call compute_components() per frame: cam-local stats only,
     no awareness of other cameras. Cheap, stateless.
  2. Director calls aggregate() each tick: applies weights and the role-bonus
     prior, which depends on global state ("did ANY camera see the ball
     recently?"). Stateless given the inputs.

Score is in [0, 1] when default weights are used (they sum to 1).
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Optional

from config import CameraConfig, ScoreWeights


@dataclass
class ScoreComponents:
    """Raw per-camera stats. No global awareness."""
    ball_visible: float        # 1.0 if ball detected, else 0.0
    ball_centrality: float     # 1 - normalized distance from frame center
    ball_size: float           # ball bbox area / frame area, scaled to [0,1]
    player_density: float      # players-near-ball count / cap, in [0,1]
    is_default_role: bool      # cam.role == policy.no_ball_default_role

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ScoreEvent:
    """Emitted by a worker every processed frame. Director consumes."""
    cam_id: str
    ts: float                  # time.monotonic()
    fps: float
    components: ScoreComponents
    detections: dict = field(default_factory=dict)


# Tuning constants (empirical; promoted to cameras.yaml only if A/B testing demands)
DENSITY_RADIUS_FRAC = 0.15     # players within this fraction of frame width count as "near ball"
DENSITY_CAP = 4                # cap on players-near-ball count
BALL_SIZE_NORM = 0.001         # ball-area / frame-area expected magnitude; map this to ~1.0


def compute_components(
    cam_cfg: CameraConfig,
    players: list,
    ball,
    frame_shape: tuple[int, int, int],
    default_role: str,
) -> ScoreComponents:
    """
    Pure function: compute per-camera raw components for one frame.

    `players` is a list of Detection-shaped objects (must expose .center, .bbox).
    `ball` is a single Detection or None.
    `frame_shape` is (h, w, 3) as returned by cv2.
    """
    h, w = frame_shape[:2]

    if ball is None:
        return ScoreComponents(
            ball_visible=0.0,
            ball_centrality=0.0,
            ball_size=0.0,
            player_density=0.0,
            is_default_role=(cam_cfg.role == default_role),
        )

    bx, by = ball.center
    cx, cy = w / 2.0, h / 2.0
    max_d = math.hypot(cx, cy)
    dist = math.hypot(bx - cx, by - cy)
    centrality = max(0.0, 1.0 - (dist / max_d if max_d > 0 else 0.0))

    bx1, by1, bx2, by2 = ball.bbox
    ball_area = max(0.0, (bx2 - bx1) * (by2 - by1))
    frame_area = max(1.0, h * w)
    size = min(1.0, (ball_area / frame_area) / BALL_SIZE_NORM)

    radius = DENSITY_RADIUS_FRAC * w
    near = 0
    for p in players:
        px, py = p.center
        if math.hypot(px - bx, py - by) <= radius:
            near += 1
            if near >= DENSITY_CAP:
                break
    density = near / DENSITY_CAP

    return ScoreComponents(
        ball_visible=1.0,
        ball_centrality=centrality,
        ball_size=size,
        player_density=density,
        is_default_role=(cam_cfg.role == default_role),
    )


def aggregate(
    components: ScoreComponents,
    weights: ScoreWeights,
    role_bonus_active: bool,
) -> tuple[float, dict]:
    """
    Combine components into a final score in [0, 1].

    `role_bonus_active` is set by the Director when global state warrants the
    role bonus (i.e. no camera has seen the ball in `no_ball_grace_seconds`,
    AND this camera is the default-role cam). The Director's job, not scoring's,
    so we just receive the boolean.
    """
    role_bonus = 1.0 if (role_bonus_active and components.is_default_role) else 0.0
    score = (
        weights.ball_visible * components.ball_visible
        + weights.ball_centrality * components.ball_centrality
        + weights.ball_size * components.ball_size
        + weights.player_density * components.player_density
        + weights.role_bonus * role_bonus
    )
    breakdown = {
        "ball_visible": components.ball_visible,
        "ball_centrality": components.ball_centrality,
        "ball_size": components.ball_size,
        "player_density": components.player_density,
        "role_bonus": role_bonus,
        "is_default_role": components.is_default_role,
        "total": score,
    }
    return score, breakdown
