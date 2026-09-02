import random
import hashlib
from dataclasses import dataclass
from enum import Enum, auto
from typing import Optional
from .deduplication import DeduplicationTable
from .link_state import LinkStateDatabase

class RoutingDecisionType(Enum):
    DELIVERED_LOCAL = auto()
    FORWARD_UNICAST = auto()
    FLOOD_BROADCAST = auto()
    DROP_DUPLICATE = auto()
    DROP_TTL_EXPIRED = auto()
    DROP_CORRUPTED = auto()

@dataclass
class RoutingDecision:
    decision: RoutingDecisionType
    frame: bytes
    next_hop: Optional[str]
    backoff_ms: int

class MeshRouter:
    def __init__(self, node_id: str):
        self.node_id = node_id
        self.dedup = DeduplicationTable()
        self.lsdb = LinkStateDatabase()

    async def ingest_frame(self, frame_bytes: bytes, ingress_node_id: str, rssi: float, snr: float) -> RoutingDecision:
        # 1. Packet Fingerprinting
        packet_hash = int(hashlib.md5(frame_bytes).hexdigest(), 16)
        if self.dedup.should_suppress(packet_hash):
            return RoutingDecision(RoutingDecisionType.DROP_DUPLICATE, frame_bytes, None, 0)
        
        self.dedup.insert(packet_hash, ingress_node_id)

        # 2. TTL Check (Assuming byte 13 is TTL)
        if len(frame_bytes) <= 13:
            return RoutingDecision(RoutingDecisionType.DROP_CORRUPTED, frame_bytes, None, 0)
        
        ttl = frame_bytes[13]
        if ttl == 0:
            return RoutingDecision(RoutingDecisionType.DROP_TTL_EXPIRED, frame_bytes, None, 0)

        # 3. Decrement TTL
        modified_frame = bytearray(frame_bytes)
        modified_frame[13] = ttl - 1
        
        # 4. Routing Decision (simplified flooding logic)
        backoff = random.randint(150, 450)
        return RoutingDecision(RoutingDecisionType.FLOOD_BROADCAST, bytes(modified_frame), None, backoff)
