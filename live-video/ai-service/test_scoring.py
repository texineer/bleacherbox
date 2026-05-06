"""
Unit tests for scoring.compute_components and scoring.aggregate.

Run standalone:
    cd live-video/ai-service && python3 test_scoring.py
"""
from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import CameraConfig, ScoreWeights
from scoring import (
    BALL_SIZE_NORM,
    DENSITY_CAP,
    DENSITY_RADIUS_FRAC,
    aggregate,
    compute_components,
)


@dataclass
class FakeDet:
    cx: int
    cy: int
    half: int = 8

    @property
    def center(self):
        return (self.cx, self.cy)

    @property
    def bbox(self):
        return (self.cx - self.half, self.cy - self.half,
                self.cx + self.half, self.cy + self.half)


def cam(cam_id: str, role: str) -> CameraConfig:
    return CameraConfig(id=cam_id, name=cam_id, role=role,
                        ingest_url=f"rtmp://localhost:1935/{cam_id}")


FRAME = (720, 1280, 3)
DEFAULT_ROLE = "wide"


def approx(a: float, b: float, tol: float = 1e-6) -> bool:
    return abs(a - b) <= tol


# -------------------- compute_components --------------------

def test_no_ball_returns_zeros_except_role_flag():
    c = compute_components(cam("cam1", "batter_box"), [], None, FRAME, DEFAULT_ROLE)
    assert c.ball_visible == 0.0
    assert c.ball_centrality == 0.0
    assert c.ball_size == 0.0
    assert c.player_density == 0.0
    assert c.is_default_role is False

    c2 = compute_components(cam("cam_w", "wide"), [], None, FRAME, DEFAULT_ROLE)
    assert c2.is_default_role is True


def test_ball_dead_center_max_centrality():
    h, w, _ = FRAME
    ball = FakeDet(cx=w // 2, cy=h // 2)
    c = compute_components(cam("cam1", "batter_box"), [], ball, FRAME, DEFAULT_ROLE)
    assert c.ball_visible == 1.0
    assert approx(c.ball_centrality, 1.0)


def test_ball_at_corner_centrality_near_zero():
    ball = FakeDet(cx=0, cy=0)
    c = compute_components(cam("cam1", "batter_box"), [], ball, FRAME, DEFAULT_ROLE)
    assert c.ball_visible == 1.0
    # At the exact corner, distance equals max diagonal, so centrality ≈ 0
    assert approx(c.ball_centrality, 0.0, tol=1e-6)


def test_ball_size_normalization():
    h, w, _ = FRAME
    # bbox ~ 32x32 => area=1024, frame_area=720*1280=921600
    # normalized: (1024 / 921600) / 0.001 = 1.111... clamped to 1.0
    ball = FakeDet(cx=w // 2, cy=h // 2, half=16)
    c = compute_components(cam("c", "x"), [], ball, FRAME, "wide")
    assert approx(c.ball_size, 1.0)

    # tiny ball: 2x2 => area=4, normalized= (4/921600)/0.001 = ~0.0043
    tiny = FakeDet(cx=w // 2, cy=h // 2, half=1)
    c2 = compute_components(cam("c", "x"), [], tiny, FRAME, "wide")
    assert 0.0 < c2.ball_size < 0.01


def test_player_density_counts_only_near_ball():
    h, w, _ = FRAME
    ball = FakeDet(cx=w // 2, cy=h // 2)
    radius = DENSITY_RADIUS_FRAC * w  # = 192 px

    # 2 players inside the radius, 2 outside
    p_inside_1 = FakeDet(cx=w // 2 + 50, cy=h // 2)
    p_inside_2 = FakeDet(cx=w // 2 - 100, cy=h // 2 + 50)
    p_outside_1 = FakeDet(cx=10, cy=10)
    p_outside_2 = FakeDet(cx=w - 10, cy=h - 10)

    c = compute_components(
        cam("c", "x"),
        [p_inside_1, p_inside_2, p_outside_1, p_outside_2],
        ball, FRAME, "wide",
    )
    assert c.player_density == 2 / DENSITY_CAP


def test_player_density_capped():
    h, w, _ = FRAME
    ball = FakeDet(cx=w // 2, cy=h // 2)
    crowd = [FakeDet(cx=w // 2 + i, cy=h // 2) for i in range(20)]
    c = compute_components(cam("c", "x"), crowd, ball, FRAME, "wide")
    assert c.player_density == 1.0  # capped at DENSITY_CAP/DENSITY_CAP


# -------------------- aggregate --------------------

def test_aggregate_with_default_weights_bounded():
    weights = ScoreWeights()
    h, w, _ = FRAME
    ball = FakeDet(cx=w // 2, cy=h // 2)
    components = compute_components(cam("c", "wide"), [ball], ball, FRAME, "wide")
    score, breakdown = aggregate(components, weights, role_bonus_active=True)
    assert 0.0 <= score <= 1.0
    # role_bonus_active AND is_default_role: role_bonus contribution is full weight.
    assert breakdown["role_bonus"] == 1.0


def test_aggregate_role_bonus_only_when_default_role():
    weights = ScoreWeights()
    components = compute_components(cam("c", "first_base"), [], None, FRAME, "wide")
    # Not the default-role cam, so role_bonus contribution is zero even when active.
    score, breakdown = aggregate(components, weights, role_bonus_active=True)
    assert breakdown["role_bonus"] == 0.0
    assert score == 0.0


def test_aggregate_role_bonus_inactive_means_zero_contribution():
    weights = ScoreWeights()
    components = compute_components(cam("c", "wide"), [], None, FRAME, "wide")
    # Default role, but bonus inactive (a cam DID see the ball recently): no bonus.
    score, breakdown = aggregate(components, weights, role_bonus_active=False)
    assert breakdown["role_bonus"] == 0.0
    assert score == 0.0


def test_aggregate_weights_sum_to_one_with_defaults():
    w = ScoreWeights()
    s = w.ball_visible + w.ball_centrality + w.ball_size + w.player_density + w.role_bonus
    assert approx(s, 1.0)


def test_aggregate_perfect_view_caps_at_one():
    weights = ScoreWeights()
    h, w, _ = FRAME
    ball = FakeDet(cx=w // 2, cy=h // 2, half=16)
    crowd = [FakeDet(cx=w // 2 + i * 5, cy=h // 2) for i in range(8)]
    components = compute_components(cam("c", "wide"), crowd, ball, FRAME, "wide")
    score, _ = aggregate(components, weights, role_bonus_active=True)
    assert approx(score, 1.0, tol=0.01)


# -------------------- runner --------------------

def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"ok  {t.__name__}")
        except AssertionError as e:
            print(f"FAIL {t.__name__}: {e}")
            failures += 1
        except Exception as e:
            print(f"ERR  {t.__name__}: {type(e).__name__}: {e}")
            failures += 1
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
