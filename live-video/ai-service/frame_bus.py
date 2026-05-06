"""
Shared-memory frame bus: one slab per camera holding the most-recent overlaid
BGR frame written by that camera's worker. Readers (Director / status_server)
memcpy out the latest bytes without locking.

Tear handling: writers bump a per-cam u64 counter after each frame write.
Readers can compare counters before/after a copy to detect torn frames; in
practice the cost of a torn frame is one dropped frame, so callers may skip
the check for hot-path reads.
"""
from __future__ import annotations

import multiprocessing as mp
from dataclasses import dataclass
from multiprocessing.shared_memory import SharedMemory
from typing import Optional

import numpy as np


@dataclass
class CameraSlab:
    cam_id: str
    shm_name: str
    counter: "mp.sharedctypes.Synchronized"  # mp.Value('Q')
    width: int
    height: int

    @property
    def nbytes(self) -> int:
        return self.height * self.width * 3


class FrameBus:
    """
    Coordinator that owns SharedMemory blocks and Value counters across procs.
    Constructed in the parent; serialize-pickled to child workers via Process args.

    Lifecycle:
        bus = FrameBus(cam_ids, height, width)
        # ... pass bus.slabs into worker processes ...
        bus.close()      # in parent on shutdown — unlinks SHM
    """

    def __init__(self, cam_ids: list[str], height: int, width: int):
        self.height = height
        self.width = width
        self._owned: list[SharedMemory] = []
        self.slabs: dict[str, CameraSlab] = {}
        for cam_id in cam_ids:
            nbytes = height * width * 3
            shm = SharedMemory(create=True, size=nbytes)
            self._owned.append(shm)
            counter = mp.Value("Q", 0, lock=True)  # atomic uint64
            self.slabs[cam_id] = CameraSlab(
                cam_id=cam_id, shm_name=shm.name, counter=counter,
                width=width, height=height,
            )

    def close(self) -> None:
        for shm in self._owned:
            try:
                shm.close()
            except Exception:
                pass
            try:
                shm.unlink()
            except Exception:
                pass
        self._owned.clear()


class FrameWriter:
    """Per-worker helper. Opens an existing SHM block by name and writes frames."""

    def __init__(self, slab: CameraSlab):
        self.slab = slab
        self._shm = SharedMemory(name=slab.shm_name)
        self._arr = np.ndarray(
            (slab.height, slab.width, 3), dtype=np.uint8, buffer=self._shm.buf
        )

    def write(self, frame: np.ndarray) -> None:
        if frame.shape != (self.slab.height, self.slab.width, 3):
            raise ValueError(
                f"frame shape {frame.shape} mismatches slab {(self.slab.height, self.slab.width, 3)}"
            )
        np.copyto(self._arr, frame)
        with self.slab.counter.get_lock():
            self.slab.counter.value += 1

    def close(self) -> None:
        try:
            self._shm.close()
        except Exception:
            pass


class FrameReader:
    """Reader-side accessor. Cheap to construct; does not own the SHM block."""

    def __init__(self, slab: CameraSlab):
        self.slab = slab
        self._shm = SharedMemory(name=slab.shm_name)
        self._arr = np.ndarray(
            (slab.height, slab.width, 3), dtype=np.uint8, buffer=self._shm.buf
        )

    @property
    def counter(self) -> int:
        return int(self.slab.counter.value)

    def latest_bytes(self) -> bytes:
        """Returns a fresh bytes copy of the current slab."""
        return bytes(self._arr.data)

    def latest_frame(self, out: Optional[np.ndarray] = None) -> np.ndarray:
        """
        Returns a numpy copy of the current slab. If `out` is provided and
        compatibly shaped, writes into it and returns it (avoids alloc).
        """
        if out is not None:
            np.copyto(out, self._arr)
            return out
        return self._arr.copy()

    def close(self) -> None:
        try:
            self._shm.close()
        except Exception:
            pass
