"""
Field calibration tool.
Run this script once before a game to define the strike zone in camera space.
Click the 4 corners of the strike zone (top-left, top-right, bottom-right, bottom-left)
on a paused frame from the camera. Saves calibration.json.

Usage:
  python calibration.py --input /dev/video0
  python calibration.py --input game_footage.mp4
"""
import cv2
import json
import argparse
import os
import sys

CALIBRATION_FILE = os.path.join(os.path.dirname(__file__), "calibration.json")
WINDOW = "Strike Zone Calibration — click 4 corners (TL, TR, BR, BL), then press ENTER"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="0", help="Camera index, video file path, or rtmp:// URL")
    parser.add_argument("--camera-id", default=None,
                        help="Optional camera id for multicam mode. "
                             "Output filename becomes calibration.<id>.json so per-camera "
                             "calibrations can coexist. Default: calibration.json")
    args = parser.parse_args()

    out_path = (
        os.path.join(os.path.dirname(__file__), f"calibration.{args.camera_id}.json")
        if args.camera_id
        else CALIBRATION_FILE
    )

    src = int(args.input) if args.input.isdigit() else args.input
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        print(f"[calibration] ERROR: Cannot open input: {args.input}")
        sys.exit(1)

    # Grab a representative frame (skip a few for camera warmup)
    for _ in range(10):
        ret, frame = cap.read()
    cap.release()

    if not ret:
        print("[calibration] ERROR: Could not read frame")
        sys.exit(1)

    # Resize for display if needed
    h, w = frame.shape[:2]
    display = frame.copy()
    points = []

    def mouse_callback(event, x, y, flags, param):
        if event == cv2.EVENT_LBUTTONDOWN and len(points) < 4:
            points.append([x, y])
            cv2.circle(display, (x, y), 6, (0, 220, 255), -1)
            labels = ["TL", "TR", "BR", "BL"]
            cv2.putText(display, labels[len(points) - 1], (x + 8, y - 8),
                        cv2.FONT_HERSHEY_DUPLEX, 0.6, (0, 220, 255), 1, cv2.LINE_AA)
            if len(points) > 1:
                cv2.line(display, tuple(points[-2]), tuple(points[-1]), (0, 220, 255), 2)
            if len(points) == 4:
                cv2.line(display, tuple(points[-1]), tuple(points[0]), (0, 220, 255), 2)
                cv2.putText(display, "Press ENTER to save, R to reset",
                            (20, h - 20), cv2.FONT_HERSHEY_DUPLEX, 0.7, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.imshow(WINDOW, display)

    cv2.namedWindow(WINDOW)
    cv2.setMouseCallback(WINDOW, mouse_callback)
    cv2.putText(display, "Click 4 corners of strike zone: TL -> TR -> BR -> BL",
                (20, 30), cv2.FONT_HERSHEY_DUPLEX, 0.65, (0, 220, 255), 1, cv2.LINE_AA)
    cv2.imshow(WINDOW, display)

    while True:
        key = cv2.waitKey(0) & 0xFF
        if key == 13 and len(points) == 4:  # ENTER
            break
        elif key == ord('r'):
            points.clear()
            display = frame.copy()
            cv2.putText(display, "Click 4 corners of strike zone: TL -> TR -> BR -> BL",
                        (20, 30), cv2.FONT_HERSHEY_DUPLEX, 0.65, (0, 220, 255), 1, cv2.LINE_AA)
            cv2.imshow(WINDOW, display)
        elif key == 27:  # ESC
            print("[calibration] Cancelled.")
            cv2.destroyAllWindows()
            sys.exit(0)

    cv2.destroyAllWindows()

    data = {"zone_points": points, "frame_size": [w, h]}
    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"[calibration] Saved to {out_path}")
    print(f"  Points: {points}")


if __name__ == "__main__":
    main()
