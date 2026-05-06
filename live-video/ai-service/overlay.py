"""
Draw AI overlays on video frames:
  - Player bounding boxes + track ID labels
  - Ball position + fading trail arc
  - Strike zone rectangle (from calibration homography)
"""
import cv2
import numpy as np
import json
import os

# BleacherBox brand colors (BGR)
COLOR_GOLD = (75, 168, 201)      # #C9A84C
COLOR_NAVY = (75, 43, 27)        # #1B2B4B
COLOR_WHITE = (255, 255, 255)
COLOR_BALL = (0, 220, 255)       # bright yellow-orange for ball

FONT = cv2.FONT_HERSHEY_DUPLEX
FONT_SCALE_LABEL = 0.55
FONT_THICKNESS = 1

CALIBRATION_FILE = os.path.join(os.path.dirname(__file__), "calibration.json")


def load_calibration(path=None):
    """
    Load saved strike zone homography data.

    path: Optional filesystem path to calibration JSON. Defaults to the
    module-adjacent calibration.json (legacy single-cam path). camera_worker
    passes a per-cam file (calibration.<id>.json) for multicam mode.
    """
    target = path if path else CALIBRATION_FILE
    if not os.path.exists(target):
        return None
    with open(target) as f:
        data = json.load(f)
    return data  # { "zone_points": [[x,y],[x,y],[x,y],[x,y]] }


def draw_player(frame, det, label=None):
    """Draw player bounding box and optional label."""
    x1, y1, x2, y2 = det.bbox
    # Gold box
    cv2.rectangle(frame, (x1, y1), (x2, y2), COLOR_GOLD, 2)
    # Label background + text
    text = label if label else f"#{det.track_id}"
    (tw, th), _ = cv2.getTextSize(text, FONT, FONT_SCALE_LABEL, FONT_THICKNESS)
    lx, ly = x1, y1 - 6
    cv2.rectangle(frame, (lx - 2, ly - th - 4), (lx + tw + 4, ly + 2), COLOR_NAVY, -1)
    cv2.putText(frame, text, (lx + 1, ly - 1), FONT, FONT_SCALE_LABEL, COLOR_GOLD, FONT_THICKNESS, cv2.LINE_AA)


def draw_ball(frame, ball_det, trail):
    """Draw ball position and fading trail."""
    if ball_det is not None:
        x1, y1, x2, y2 = ball_det.bbox
        cx, cy = ball_det.center
        # Bright circle at ball position
        radius = max(8, (x2 - x1) // 2 + 2)
        cv2.circle(frame, (cx, cy), radius, COLOR_BALL, 2)
        cv2.circle(frame, (cx, cy), 3, COLOR_BALL, -1)

    # Draw fading trail
    n = len(trail)
    for i in range(1, n):
        alpha = i / n  # 0 = oldest (faint), 1 = newest (bright)
        color = tuple(int(c * alpha) for c in COLOR_BALL)
        thickness = max(1, int(3 * alpha))
        cv2.line(frame, trail[i - 1], trail[i], color, thickness, cv2.LINE_AA)


def draw_strike_zone(frame, calibration):
    """
    Draw strike zone rectangle on home plate using calibration data.
    calibration: { "zone_points": [[x,y]x4] } — four corners of the strike zone
    in image coordinates (already projected from homography).
    """
    if calibration is None:
        return

    pts = calibration.get("zone_points")
    if not pts or len(pts) != 4:
        return

    pts_arr = np.array(pts, dtype=np.int32)

    # Semi-transparent navy fill
    overlay = frame.copy()
    cv2.fillPoly(overlay, [pts_arr], (*COLOR_NAVY[::-1], 120))
    cv2.addWeighted(overlay, 0.25, frame, 0.75, 0, frame)

    # Gold border
    cv2.polylines(frame, [pts_arr], isClosed=True, color=COLOR_GOLD, thickness=2, lineType=cv2.LINE_AA)

    # "ZONE" label
    cx = int(np.mean([p[0] for p in pts]))
    cy = int(np.mean([p[1] for p in pts]))
    cv2.putText(frame, "ZONE", (cx - 22, cy + 5), FONT, 0.45, COLOR_GOLD, 1, cv2.LINE_AA)


def draw_frame(frame, players, ball_det, ball_trail, calibration, player_labels=None):
    """
    Master overlay function. Draws everything on the frame in-place.
    player_labels: optional dict of track_id -> label string
    """
    if player_labels is None:
        player_labels = {}

    # Strike zone first (bottom layer)
    draw_strike_zone(frame, calibration)

    # Ball trail + position
    draw_ball(frame, ball_det, ball_trail)

    # Players on top
    for det in players:
        label = player_labels.get(det.track_id)
        draw_player(frame, det, label)

    return frame
