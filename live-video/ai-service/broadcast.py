"""
Multi-camera broadcast entrypoint.

Phase B: starts N camera workers (one per enabled camera), each writing its
overlaid frame into a shared-memory slab, and writes the cam[0] slab to stdout
at output.fps. The Director (Phase C) replaces the hardcoded selection.

Pipe to FFmpeg via stream/stream.sh MODE=multicam:

    python3 ai-service/broadcast.py --config cameras.yaml \\
      | ffmpeg -f rawvideo -pix_fmt bgr24 -s 1280x720 -r 30 -i pipe:0 ...
"""
from __future__ import annotations

import argparse
import logging
import multiprocessing as mp
import os
import signal
import sys
import time
from pathlib import Path

# Make sibling modules importable when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from camera_worker import CameraWorker  # noqa: E402
from config import FleetConfig, load_config  # noqa: E402
from director import Director  # noqa: E402
from frame_bus import FrameBus, FrameReader  # noqa: E402
from scoring import ScoreEvent  # noqa: E402
from status_server import start_status_server  # noqa: E402

log = logging.getLogger("broadcast")


class Broadcast:
    def __init__(self, cfg: FleetConfig):
        self.cfg = cfg
        self.frame_bus: FrameBus | None = None
        self.workers: list[CameraWorker] = []
        self.score_queue: mp.Queue = mp.Queue(maxsize=4096)
        self.director: Director | None = None
        self._readers: dict[str, FrameReader] = {}
        self._stopping = False

    def start_workers(self) -> None:
        cams = self.cfg.enabled_cameras
        if not cams:
            raise RuntimeError("no enabled cameras in cameras.yaml")
        cam_ids = [c.id for c in cams]
        self.frame_bus = FrameBus(cam_ids, height=self.cfg.output.height, width=self.cfg.output.width)

        calibration_dir = str(Path(__file__).resolve().parent)
        for cam in cams:
            slab = self.frame_bus.slabs[cam.id]
            w = CameraWorker(
                cam_cfg=cam,
                slab=slab,
                score_queue=self.score_queue,
                inference=self.cfg.inference,
                output=self.cfg.output,
                policy=self.cfg.director.policy,
                calibration_dir=calibration_dir,
            )
            w.start()
            self.workers.append(w)
            log.info("started worker pid=%d for cam=%s (%s)", w.pid, cam.id, cam.name)

        # Director + readers
        self.director = Director(
            cfg=self.cfg.director,
            cam_id_to_role={c.id: c.role for c in cams},
            initial_cam=cams[0].id,
        )
        for cam in cams:
            self._readers[cam.id] = FrameReader(self.frame_bus.slabs[cam.id])

        # Status server in a daemon thread.
        start_status_server(
            self.director, self._readers,
            host=self.cfg.status_server.host,
            port=self.cfg.status_server.port,
        )

    def stop(self, *_args) -> None:
        self._stopping = True

    def _shutdown(self) -> None:
        for w in self.workers:
            if w.is_alive():
                w.terminate()
        deadline = time.monotonic() + 5.0
        for w in self.workers:
            remaining = max(0.1, deadline - time.monotonic())
            w.join(timeout=remaining)
            if w.is_alive():
                log.warning("worker %s still alive after grace, killing", w.name)
                w.kill()
        if self.frame_bus is not None:
            self.frame_bus.close()
        log.info("broadcast shutdown complete")

    def run(self) -> int:
        signal.signal(signal.SIGINT, self.stop)
        signal.signal(signal.SIGTERM, self.stop)

        self.start_workers()
        assert self.director is not None

        period = 1.0 / self.cfg.output.fps
        next_t = time.monotonic()
        out_fd = sys.stdout.buffer
        emitted = 0
        last_status = time.monotonic()
        last_switch_log = self.director.current

        try:
            while not self._stopping:
                # Drain pending score events and update director.
                events = self._drain_scores()
                now = time.monotonic()
                selected_cam_id = self.director.consume(events, now=now)

                if selected_cam_id != last_switch_log:
                    log.info("director output switched: %s -> %s",
                             last_switch_log, selected_cam_id)
                    last_switch_log = selected_cam_id

                reader = self._readers[selected_cam_id]
                payload = reader.latest_bytes()
                try:
                    out_fd.write(payload)
                    out_fd.flush()
                except BrokenPipeError:
                    log.info("downstream closed pipe; exiting")
                    break
                emitted += 1

                next_t += period
                sleep_dt = next_t - time.monotonic()
                if sleep_dt > 0:
                    time.sleep(sleep_dt)
                else:
                    next_t = time.monotonic()

                if now - last_status > 5.0:
                    snap = self.director.snapshot()
                    log.info(
                        "emitted=%d current=%s ewma=%s",
                        emitted, snap.current,
                        {cid: round(c["ewma"], 3) for cid, c in snap.cameras.items()},
                    )
                    last_status = now
        finally:
            self._shutdown()

        return 0

    def _drain_scores(self) -> list[ScoreEvent]:
        events: list[ScoreEvent] = []
        # Cap the drain to prevent the loop from getting stuck on a flooded queue.
        for _ in range(2048):
            try:
                events.append(self.score_queue.get_nowait())
            except Exception:
                break
        return events


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "cameras.yaml",
        help="Path to cameras.yaml",
    )
    parser.add_argument("--log-level", default=os.environ.get("BROADCAST_LOG_LEVEL", "INFO"))
    args = parser.parse_args(argv)

    logging.basicConfig(
        stream=sys.stderr,  # stdout reserved for the BGR frame pipe
        level=args.log_level,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
    )
    cfg = load_config(args.config)
    log.info("loaded %d cameras (%d enabled) from %s",
             len(cfg.cameras), len(cfg.enabled_cameras), args.config)

    return Broadcast(cfg).run()


if __name__ == "__main__":
    # On macOS, mp default is "spawn" which re-imports the module; keep main
    # behind __main__ to avoid recursive child startup.
    sys.exit(main())
