"""
Incident Repository: Handles asynchronous transaction blocks for Laksha.
Deduplicates multiple identical incoming transmissions within a 120-second active window.
"""

from __future__ import annotations
import json
import time
import uuid
from typing import Any, Dict, List, Tuple
import aiosqlite
from .database import AsyncDatabaseManager

class IncidentRepository:
    """
    Implements optimized data-access methods with automated packet deduplication,
    batch transactional inserts, and real-time dashboard priorities.
    """
    def __init__(self, db_manager: AsyncDatabaseManager) -> None:
        self.db_manager = db_manager

    async def upsert_incident_from_frame(
        self, 
        decoded_payload: dict[str, Any], 
        raw_hex: str, 
        hop_trail: list[dict[str, Any]]
    ) -> Tuple[str, bool]:
        """
        Ingests a verified Laksha emergency frame and dynamic RF hops.
        
        Business/Safety Logic:
            - If node_id has generated an active incident within the last 120 seconds,
              this represents a retransmitted packet or redundant relay path.
              - Action: Update latest GPS, battery_percent, altitude, and touch last_updated_at.
              - Append all new hop telemetry logs.
              - Return (incident_id, is_duplicate=True).
            - Else, create a new incident.
              - Generate a timestamp-ordered ULID-equivalent ID.
              - Batch insert the master record and initial hops inside a single ACID transaction.
              - Log 'FRAME_INGESTED' system audit trail event.
              - Return (incident_id, is_duplicate=False).
        """
        node_id = decoded_payload["nodeId"]
        lat = decoded_payload["latitude"]
        lon = decoded_payload["longitude"]
        altitude = decoded_payload.get("altitude_m", None)
        triage_code = decoded_payload["triageType"]
        is_conscious = 1 if decoded_payload["isConscious"] else 0
        is_group = 1 if decoded_payload["groupCount"] else 0
        battery = decoded_payload["batteryPercent"]
        ttl = decoded_payload["ttl"]
        
        now_ms = int(time.time() * 1000)
        window_start_ms = now_ms - 120000

        async with self.db_manager.get_db() as db:
            # Serialize the dedupe decision with the following write. WAL permits
            # readers while BEGIN IMMEDIATE reserves the single SQLite writer slot.
            await db.execute("BEGIN IMMEDIATE;")
            if len(raw_hex) != 32 or any(character not in "0123456789abcdefABCDEF" for character in raw_hex):
                await db.rollback()
                raise ValueError("raw_hex must contain exactly 32 hexadecimal characters")
            if not 1 <= triage_code <= 4 or not 0 <= battery <= 100 or not 0 <= ttl <= 7:
                await db.rollback()
                raise ValueError("decoded payload contains an invalid triage, battery, or TTL value")
            # 1. Look for existing active/non-resolved incident for this node within 120 seconds
            cursor = await db.execute("""
                SELECT id FROM incidents
                WHERE node_id = ? AND status != 'RESOLVED' AND last_updated_at >= ?
                ORDER BY first_received_at DESC LIMIT 1;
            """, (node_id, window_start_ms))
            row = await cursor.fetchone()

            if row:
                incident_id = row[0]
                # Update existing master record
                await db.execute("""
                    UPDATE incidents
                    SET latitude = ?, longitude = ?, altitude_m = COALESCE(?, altitude_m),
                        battery_percent = ?, last_updated_at = ?
                    WHERE id = ?;
                """, (lat, lon, altitude, battery, now_ms, incident_id))

                # Append hop records
                for hop in hop_trail:
                    await db.execute("""
                        INSERT INTO packet_hops (
                            incident_id, hop_sequence, repeater_node_id, 
                            rssi_dbm, snr_db, path_loss_db, estimated_pdr, received_timestamp
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                    """, (
                        incident_id, hop["hop"], hop["to"], 
                        hop["rssi"], hop["snr"], hop.get("path_loss_db", 0.0), 
                        hop["pdr"], now_ms
                    ))
                
                await db.commit()
                return incident_id, True

            # 2. Complete New Incident Path (ACID transaction block)
            # Create a localized pseudo-ULID (combines current timestamp high-precision with random identifier)
            unique_time_part = f"{now_ms:012x}"
            unique_rand_part = uuid.uuid4().hex[:16]
            incident_id = f"{unique_time_part}-{unique_rand_part}"

            await db.execute("""
                INSERT INTO incidents (
                    id, node_id, latitude, longitude, altitude_m, triage_code,
                    is_conscious, is_group, battery_percent, initial_ttl,
                    raw_hex, crc_verified, status, first_received_at, last_updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'PENDING', ?, ?);
            """, (
                incident_id, node_id, lat, lon, altitude, triage_code,
                is_conscious, is_group, battery, ttl, raw_hex, now_ms, now_ms
            ))

            # Batch insert packet hops
            for hop in hop_trail:
                await db.execute("""
                    INSERT INTO packet_hops (
                        incident_id, hop_sequence, repeater_node_id, 
                        rssi_dbm, snr_db, path_loss_db, estimated_pdr, received_timestamp
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """, (
                    incident_id, hop["hop"], hop["to"], 
                    hop["rssi"], hop["snr"], hop.get("path_loss_db", 0.0), 
                    hop["pdr"], now_ms
                ))

            # Insert system audit log record
            details = {
                "node_id": node_id,
                "triage_code": triage_code,
                "lat": lat,
                "lon": lon,
                "hops_count": len(hop_trail)
            }
            await db.execute("""
                INSERT INTO system_audit_log (event_type, source_node, details_json, created_at)
                VALUES ('FRAME_INGESTED', ?, ?, ?);
            """, (f"NODE-{node_id}", json.dumps(details), now_ms))

            await db.commit()
            return incident_id, False

    async def transition_incident_status(
        self, 
        incident_id: str, 
        new_status: str, 
        assigned_team: str | None = None
    ) -> bool:
        """
        Transition an incident state ('PENDING', 'ACKNOWLEDGED', 'DISPATCHED', etc.) and
        assign field responders.
        """
        now_ms = int(time.time() * 1000)
        async with self.db_manager.get_db() as db:
            cursor = await db.execute("""
                UPDATE incidents
                SET status = ?, assigned_team = ?, last_updated_at = ?
                WHERE id = ?;
            """, (new_status, assigned_team, now_ms, incident_id))
            await db.commit()
            return cursor.rowcount > 0

    async def get_triage_dashboard_queue(self) -> list[dict[str, Any]]:
        """
        Retrieves active pending/acknowledged incidents joined with their full hop histories,
        sorted by highest triage priority, and longest active wait time.
        """
        async with self.db_manager.get_db() as db:
            db.row_factory = aiosqlite.Row
            # Fetch all active master incidents
            cursor = await db.execute("""
                SELECT * FROM incidents
                WHERE status IN ('PENDING', 'ACKNOWLEDGED', 'DISPATCHED')
                ORDER BY triage_code DESC, first_received_at ASC;
            """)
            incidents_rows = await cursor.fetchall()
            
            dashboard_data = []
            for row in incidents_rows:
                incident_dict = dict(row)
                # Query associated routing path logs
                hops_cursor = await db.execute("""
                    SELECT * FROM packet_hops
                    WHERE incident_id = ?
                    ORDER BY hop_sequence ASC;
                """, (incident_dict["id"],))
                hops_rows = await hops_cursor.fetchall()
                incident_dict["hop_history"] = [dict(h) for h in hops_rows]
                dashboard_data.append(incident_dict)
                
            return dashboard_data

    async def prune_historical_data(self, retention_days: int = 30) -> int:
        """
        Deletes old resolved, false alarm, or inactive incidents beyond the configured retention period
        to prevent flash memory wear-out and save local disk space.
        """
        limit_ms = int(time.time() * 1000) - (retention_days * 24 * 3600 * 1000)
        async with self.db_manager.get_db() as db:
            # Foreign keys trigger ON DELETE CASCADE automatically deleting the child packet_hops rows
            cursor = await db.execute("""
                DELETE FROM incidents
                WHERE last_updated_at < ? AND status IN ('RESOLVED', 'FALSE_ALARM');
            """, (limit_ms,))
            
            # Prune associated old audit log files
            await db.execute("""
                DELETE FROM system_audit_log WHERE created_at < ?;
            """, (limit_ms,))
            
            await db.commit()
            return cursor.rowcount
