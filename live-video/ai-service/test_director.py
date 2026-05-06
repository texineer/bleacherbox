"""
Unit tests for the Director's EWMA + hysteresis logic.

Run standalone:
    cd live-video/ai-service && python3 test_director.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import DirectorConfig, DirectorPolicy, ScoreWeights
from director import Director
from scoring import ScoreComponents, ScoreEvent


def director(initial="cam1", **policy_overrides):
    pol = DirectorPolicy(**{
        "switch_threshold": 0.10,
        "dwell_seconds": 1.0,
        "ewma_alpha": 1.0,           # alpha=1 ⇒ ewma == latest, easier to reason about in tests
        "no_ball_default_role": "wide",
        "no_ball_grace_seconds": 5.0,
        **policy_overrides,
    })
    cfg = DirectorConfig(policy=pol, weights=ScoreWeights())
    return Director(
        cfg=cfg,
        cam_id_to_role={"cam1": "batter_box", "cam2": "first_base", "cam3": "wide"},
        initial_cam=initial,
    )


def ev(cam_id: str, ts: float, *, ball=False, centrality=0.0, size=0.0, density=0.0,
       is_default_role=False) -> ScoreEvent:
    return ScoreEvent(
        cam_id=cam_id,
        ts=ts,
        fps=30.0,
        components=ScoreComponents(
            ball_visible=1.0 if ball else 0.0,
            ball_centrality=centrality,
            ball_size=size,
            player_density=density,
            is_default_role=is_default_role,
        ),
    )


# -------------------- happy-path switching --------------------

def test_no_events_keeps_current():
    d = director(initial="cam1")
    assert d.consume([], now=0.0) == "cam1"


def test_switches_after_dwell_when_threshold_exceeded():
    d = director(initial="cam1", switch_threshold=0.10, dwell_seconds=1.0)

    # cam2 dominant. cam1 sees nothing.
    t = 0.0
    events = [
        ev("cam1", t, ball=False),
        ev("cam2", t, ball=True, centrality=1.0, size=1.0, density=1.0),
    ]
    out = d.consume(events, now=t)
    # After first tick: cam2 challenges but dwell hasn't elapsed yet.
    assert out == "cam1", f"expected hold cam1 before dwell, got {out}"
    assert d.challenger == "cam2"

    # 0.5s later: still holding (under dwell).
    t = 0.5
    out = d.consume([
        ev("cam1", t, ball=False),
        ev("cam2", t, ball=True, centrality=1.0, size=1.0, density=1.0),
    ], now=t)
    assert out == "cam1"

    # 1.5s after challenger started: switch.
    t = 1.5
    out = d.consume([
        ev("cam1", t, ball=False),
        ev("cam2", t, ball=True, centrality=1.0, size=1.0, density=1.0),
    ], now=t)
    assert out == "cam2", f"expected switch to cam2 after dwell, got {out}"
    assert d.challenger is None


def test_does_not_switch_if_threshold_not_exceeded():
    d = director(initial="cam1", switch_threshold=0.50, dwell_seconds=1.0)

    # cam2 only marginally better — within threshold.
    for t in (0.0, 0.5, 1.0, 2.0):
        out = d.consume([
            ev("cam1", t, ball=True, centrality=0.5, size=0.5, density=0.5),
            ev("cam2", t, ball=True, centrality=0.7, size=0.5, density=0.5),
        ], now=t)
        assert out == "cam1", f"unexpected switch at t={t}: {out}"


def test_chatter_is_suppressed_when_challenger_changes():
    """A different cam each tick should never trigger a switch."""
    d = director(initial="cam1", switch_threshold=0.10, dwell_seconds=1.0)

    # cam2 leads at t=0, cam3 leads at t=0.5, then cam2 again — challenger changes
    # so the dwell timer resets each time.
    out = d.consume([
        ev("cam1", 0.0, ball=False),
        ev("cam2", 0.0, ball=True, centrality=1.0, size=1.0, density=1.0),
        ev("cam3", 0.0, ball=False),
    ], now=0.0)
    assert out == "cam1"
    assert d.challenger == "cam2"

    out = d.consume([
        ev("cam1", 0.5, ball=False),
        ev("cam2", 0.5, ball=False),
        ev("cam3", 0.5, ball=True, centrality=1.0, size=1.0, density=1.0,
           is_default_role=True),
    ], now=0.5)
    assert out == "cam1"
    assert d.challenger == "cam3"  # challenger changed, timer reset

    out = d.consume([
        ev("cam1", 1.4, ball=False),
        ev("cam2", 1.4, ball=True, centrality=1.0, size=1.0, density=1.0),
        ev("cam3", 1.4, ball=False),
    ], now=1.4)
    # cam2 leads again; dwell starts over from t=1.4
    assert out == "cam1"
    assert d.challenger == "cam2"


# -------------------- role bonus --------------------

def test_role_bonus_kicks_in_after_grace():
    d = director(initial="cam1", switch_threshold=0.05, dwell_seconds=0.5,
                 no_ball_grace_seconds=2.0, no_ball_default_role="wide")

    # No camera ever sees a ball. Default-role cam (cam3=wide) should win after grace.
    t = 0.0
    out = d.consume([
        ev("cam1", t, is_default_role=False),
        ev("cam2", t, is_default_role=False),
        ev("cam3", t, is_default_role=True),
    ], now=t)
    # Grace not elapsed (global_last_ball_ts is 0 → time_since_ball = inf,
    # so role_bonus_active is True from the very first tick when no ball was ever seen).
    # But challenger needs dwell to switch. Confirm cam3 is the challenger.
    assert d.challenger == "cam3"

    # After dwell, switch.
    t = 0.6
    out = d.consume([
        ev("cam1", t, is_default_role=False),
        ev("cam2", t, is_default_role=False),
        ev("cam3", t, is_default_role=True),
    ], now=t)
    assert out == "cam3"


def test_role_bonus_suppressed_when_ball_recently_seen():
    d = director(initial="cam1", switch_threshold=0.05, dwell_seconds=0.5,
                 no_ball_grace_seconds=5.0, no_ball_default_role="wide")

    # cam2 sees the ball at t=0 — that arms global_last_ball_ts.
    # Then no cam sees it after, but grace is 5s so role_bonus stays inactive.
    out = d.consume([
        ev("cam1", 0.0, is_default_role=False),
        ev("cam2", 0.0, ball=True, centrality=1.0, size=0.5, density=0.5,
           is_default_role=False),
        ev("cam3", 0.0, is_default_role=True),
    ], now=0.0)

    # Now ball is gone everywhere, but only 1s passed (grace=5s).
    out = d.consume([
        ev("cam1", 1.0, is_default_role=False),
        ev("cam2", 1.0, is_default_role=False),
        ev("cam3", 1.0, is_default_role=True),
    ], now=1.0)
    # cam3 should NOT be challenging because role_bonus inactive — all aggregates 0.
    assert d.challenger is None or d.challenger != "cam3" or d.cams["cam3"].ewma == 0.0


# -------------------- override --------------------

def test_override_pins_immediately():
    d = director(initial="cam1")
    d.set_override("cam2")
    out = d.consume([
        ev("cam1", 0.0, ball=True, centrality=1.0, size=1.0, density=1.0),
    ], now=0.0)
    assert out == "cam2"
    assert d.current == "cam2"

    # Clearing the override resumes normal selection from `current` (= cam2).
    # Hysteresis still applies: cam1 outscores cam2, but it has to win the dwell.
    d.set_override(None)
    out = d.consume([
        ev("cam1", 0.1, ball=True, centrality=1.0, size=1.0, density=1.0),
    ], now=0.1)
    assert out == "cam2", "expected cam2 to hold until dwell elapses"
    assert d.challenger == "cam1"

    # After dwell, cam1 wins.
    out = d.consume([
        ev("cam1", 1.5, ball=True, centrality=1.0, size=1.0, density=1.0),
    ], now=1.5)
    assert out == "cam1"


def test_override_unknown_cam_raises():
    d = director(initial="cam1")
    try:
        d.set_override("doesnotexist")
    except KeyError:
        return
    assert False, "expected KeyError"


# -------------------- snapshot --------------------

def test_snapshot_exposes_state():
    d = director(initial="cam1")
    d.consume([
        ev("cam1", 0.0, ball=True, centrality=0.5, size=0.5, density=0.5),
    ], now=0.0)
    snap = d.snapshot()
    assert snap.current == "cam1"
    assert "cam1" in snap.cameras
    assert "ewma" in snap.cameras["cam1"]
    assert "breakdown" in snap.cameras["cam1"]


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
