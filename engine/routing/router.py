import random
import hashlib
from dataclasses import dataclass
from enum import Enum, auto
from typing import Any, Optional
import networkx as nx
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

@dataclass
class BufferedPacket:
    packet_id: str
    frame: bytes
    destination: str
    source: str
    route: list[str]
    next_hop: Optional[str]
    routing_header: dict[str, Any]

class MeshRouter:
    def __init__(self, node_id: str):
        self.node_id = node_id
        self.dedup = DeduplicationTable()
        self.lsdb = LinkStateDatabase()
        self.topology: Any = None
        self._unsubscribe_topology: Optional[Any] = None
        self._route_cache: dict[tuple[str, str, int], list[str]] = {}
        self.buffered_packets: dict[str, BufferedPacket] = {}

    def attach_topology(self, topology: Any) -> None:
        """Attach to an RFMeshTopology-like object and heal routes on every change."""
        if self._unsubscribe_topology:
            self._unsubscribe_topology()
        self.topology = topology
        self._route_cache.clear()
        self._unsubscribe_topology = topology.subscribe(self._on_topology_change)

    def close(self) -> None:
        if self._unsubscribe_topology:
            self._unsubscribe_topology()
            self._unsubscribe_topology = None

    def _on_topology_change(self, _change: Any) -> None:
        self._route_cache.clear()
        for packet in self.buffered_packets.values():
            self._reroute_packet(packet)

    def _find_route(self, source: str, destination: str) -> Optional[list[str]]:
        if self.topology is None:
            return [source, destination] if source == self.node_id and source == destination else None
        version = self.topology.version
        cache_key = (source, destination, version)
        if cache_key in self._route_cache:
            return list(self._route_cache[cache_key])
        graph = self.topology.graph.copy()
        graph.remove_edges_from([(u, v) for u, v, data in graph.edges(data=True) if data.get("weight") == float("inf")])
        try:
            route = nx.shortest_path(graph, source, destination, weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return None
        self._route_cache[cache_key] = route
        return list(route)

    def _reroute_packet(self, packet: BufferedPacket) -> bool:
        route = self._find_route(packet.source, packet.destination)
        packet.route = route or []
        packet.next_hop = route[1] if route and len(route) > 1 else None
        packet.routing_header = {
            "source": packet.source,
            "destination": packet.destination,
            "route": list(packet.route),
            "next_hop": packet.next_hop,
            "topology_version": getattr(self.topology, "version", 0),
        }
        return route is not None

    def enqueue_packet(self, packet_id: str, frame: bytes, destination: str, source: Optional[str] = None) -> BufferedPacket:
        packet = BufferedPacket(packet_id, frame, destination, source or self.node_id, [], None, {})
        self.buffered_packets[packet_id] = packet
        self._reroute_packet(packet)
        return packet

    def drain_routable_packets(self) -> list[BufferedPacket]:
        """Return packets with a valid next hop without removing them from the queue."""
        return [packet for packet in self.buffered_packets.values() if packet.next_hop is not None]

    def acknowledge_forwarded(self, packet_id: str) -> None:
        self.buffered_packets.pop(packet_id, None)

    def report_link_drop(self, from_id: str, to_id: str) -> None:
        if self.topology is None:
            raise RuntimeError("a topology must be attached before reporting link drops")
        self.topology.set_edge_blocked(from_id, to_id, True)

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
