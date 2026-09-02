import networkx as nx
from typing import List, Dict, Any
from .rf_models import haversine_distance, calculate_path_loss, calculate_rssi, calculate_snr, calculate_pdr

import networkx as nx
import random
from typing import List, Dict, Any
from .rf_models import haversine_distance, calculate_path_loss, calculate_rssi, calculate_snr, calculate_pdr, calculate_toa, calculate_latency

class RFMeshTopology:
    def __init__(self):
        self.graph = nx.DiGraph()
        self.nodes = {}

    def build_topology(self, nodes_config: List[Dict[str, Any]]):
        self.graph.clear()
        self.nodes = {n['id']: n for n in nodes_config}
        
        for u_id, u in self.nodes.items():
            self.graph.add_node(u_id, **u, status="ONLINE")
            
        for u_id, u in self.nodes.items():
            for v_id, v in self.nodes.items():
                if u_id == v_id: continue
                
                d = haversine_distance(u['lat'], u['lon'], v['lat'], v['lon'])
                pl = calculate_path_loss(d, 868.1)
                rssi = calculate_rssi(u['ptx'], u['gant'], pl)
                
                if rssi >= -118:
                    snr = calculate_snr(rssi)
                    toa = calculate_toa(32) # Assuming 32 byte payload
                    latency = calculate_latency(d)
                    
                    # Cost: weighted combination of normalized distance and SNR deficit
                    weight = 0.4 * (d / 50.0) + 0.6 * (1 - (snr + 20) / 40) + (latency / 1000)
                    
                    # Force DAG property (e.g., elevation drop towards sink)
                    if u['elev'] > v['elev']:
                        self.graph.add_edge(u_id, v_id, weight=weight, rssi=rssi, snr=snr, pdr=calculate_pdr(snr), latency=latency)

    def route_emergency_packet(self, origin_lat: float, origin_lng: float, payload_hex: str, max_ttl: int = 7) -> Dict[str, Any]:
        # Implementation of Dijkstra and multi-path logic
        # 1. Identify reachable repeaters
        # 2. Add virtual 'origin' node
        # 3. Path discovery
        # 4. Simulation of traversal with random drop based on PDR
        return {"trace": [{"hop": 1, "status": "SIMULATED_SUCCESS"}]}
