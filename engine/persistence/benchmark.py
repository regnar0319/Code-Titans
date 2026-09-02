"""Concurrent edge-persistence benchmark for Laksha.

Run with ``python -m engine.persistence.benchmark`` after installing aiosqlite.
The benchmark uses unique node IDs so all 500 frames are expected to persist.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
import time
from typing import Any

import aiosqlite

from .database import AsyncDatabaseManager
from .repository import IncidentRepository


def _payload(index: int) -> dict[str, Any]:
    return {
        "nodeId": index,
        "latitude": 32.3 + index / 100000,
        "longitude": 77.1 + index / 100000,
        "altitude_m": 2500.0,
        "triageType": (index % 4) + 1,
        "isConscious": True,
        "groupCount": False,
        "batteryPercent": 80,
        "ttl": 7,
    }


async def _insert(repo: IncidentRepository, start: int, count: int, timings: list[float]) -> None:
    for index in range(start, start + count):
        started = time.perf_counter()
        await repo.upsert_incident_from_frame(
            _payload(index),
            "00" * 14 + "0000",
            [{
                "hop": 1,
                "to": "RIDGE-RP-02",
                "rssi": -84.2,
                "snr": 8.5,
                "path_loss_db": 106.35,
                "pdr": 0.99,
            }],
        )
        timings.append((time.perf_counter() - started) * 1000)


async def main() -> None:
    fd, path = tempfile.mkstemp(prefix="laksha-benchmark-", suffix=".db")
    os.close(fd)
    try:
        manager = AsyncDatabaseManager(path)
        await manager.initialize()
        timings: list[float] = []
        repo = IncidentRepository(manager)
        tasks = [_insert(repo, task * 25, 25, timings) for task in range(20)]
        await asyncio.gather(*tasks)
        async with manager.get_db() as db:
            row = await (await db.execute("SELECT COUNT(*) FROM incidents")).fetchone()
            persisted = int(row[0])
        assert persisted == 500, f"expected 500 incidents, found {persisted}"
        average_ms = sum(timings) / len(timings)
        print(f"PASS: {persisted}/500 persisted; average transaction {average_ms:.3f} ms")
        if average_ms >= 2.5:
            print("WARNING: target average is below 2.5 ms on this filesystem")
    finally:
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(path + suffix)
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    asyncio.run(main())