"""
Laksha Persistence Engine: Crash-Resistant, Time-Series Edge Database.
Fully asynchronous SQLite execution using aiosqlite, tuned for embedded eMMC/SD-card lifetime.
"""

from __future__ import annotations
import os
import aiosqlite
from contextlib import asynccontextmanager
from typing import AsyncIterator

class AsyncDatabaseManager:
    """
    Manages SQLite connection lifecycles with advanced PRAGMA settings to guarantee
    atomicity, power-loss survival, and high write concurrency on edge nodes.
    """
    def __init__(self, db_path: str = "laksha_edge.db") -> None:
        self.db_path = db_path

    @asynccontextmanager
    async def get_db(self) -> AsyncIterator[aiosqlite.Connection]:
        """
        Context manager that provides a tuned, high-throughput database connection.
        Applies performance pragmas to the session upon acquisition.
        """
        conn = await aiosqlite.connect(self.db_path)
        try:
            # Enforce mission-critical embedded database settings
            await conn.execute("PRAGMA journal_mode = WAL;")          # Write-Ahead Logging for high concurrency
            await conn.execute("PRAGMA synchronous = NORMAL;")        # Protect against filesystem corruptions safely
            await conn.execute("PRAGMA busy_timeout = 5000;")         # Wait up to 5000ms before failing on concurrency lock
            await conn.execute("PRAGMA foreign_keys = ON;")           # Strict relational data integrity validation
            await conn.execute("PRAGMA cache_size = -8000;")          # 8MB memory-resident cache to reduce SSD reads
            await conn.execute("PRAGMA auto_vacuum = INCREMENTAL;")   # Slow space reclaim to prevent performance spikes
            yield conn
        except aiosqlite.OperationalError:
            # Never leave a failed write transaction pending on a pooled/returned handle.
            try:
                await conn.rollback()
            except aiosqlite.OperationalError:
                pass
            raise
        finally:
            await conn.close()

    async def initialize(self) -> None:
        """
        Executes relational database schema migrations and creates physical indices.
        Invoked on system startup before processing any radio packets.
        """
        async with self.get_db() as db:
            await db.execute("PRAGMA foreign_keys = ON;")
            
            # Table 1: Core SOS Incidents Master Registry
            await db.execute("""
                CREATE TABLE IF NOT EXISTS incidents (
                    id TEXT PRIMARY KEY,
                    node_id INTEGER NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    altitude_m REAL DEFAULT NULL,
                    triage_code INTEGER NOT NULL,
                    is_conscious INTEGER NOT NULL,
                    is_group INTEGER NOT NULL,
                    battery_percent INTEGER NOT NULL,
                    initial_ttl INTEGER NOT NULL,
                    raw_hex TEXT NOT NULL,
                    crc_verified INTEGER NOT NULL DEFAULT 1,
                    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'ACKNOWLEDGED', 'DISPATCHED', 'RESOLVED', 'FALSE_ALARM')),
                    assigned_team TEXT DEFAULT NULL,
                    first_received_at INTEGER NOT NULL,
                    last_updated_at INTEGER NOT NULL
                );
            """)

            # Table 2: Hop-by-Hop Telemetry Trail
            await db.execute("""
                CREATE TABLE IF NOT EXISTS packet_hops (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
                    hop_sequence INTEGER NOT NULL,
                    repeater_node_id TEXT NOT NULL,
                    rssi_dbm REAL NOT NULL,
                    snr_db REAL NOT NULL,
                    path_loss_db REAL NOT NULL,
                    estimated_pdr REAL NOT NULL,
                    received_timestamp INTEGER NOT NULL
                );
            """)

            # Table 3: Low-level health diagnostics
            await db.execute("""
                CREATE TABLE IF NOT EXISTS system_audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    source_node TEXT DEFAULT NULL,
                    details_json TEXT DEFAULT NULL,
                    created_at INTEGER NOT NULL
                );
            """)

            # Speed Indices
            await db.execute("CREATE INDEX IF NOT EXISTS idx_incidents_status_triage ON incidents(status, triage_code DESC, first_received_at ASC);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_incidents_node_time ON incidents(node_id, first_received_at DESC);")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_hops_incident_seq ON packet_hops(incident_id, hop_sequence ASC);")
            await db.commit()

    async def wal_checkpoint(self) -> None:
        """
        Manually flush WAL log entries into the main storage file.
        Run this during idle radio periods to optimize disk space.
        """
        async with self.get_db() as db:
            await db.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            await db.commit()
