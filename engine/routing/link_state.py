import time
from dataclasses import dataclass
from typing import Dict

@dataclass
class NeighborRecord:
    node_id: str
    last_seen: float
    smoothed_rssi: float
    smoothed_pdr: float
    hop_dist: int

class LinkStateDatabase:
    def __init__(self, alpha: float = 0.5, beta: float = 0.3, gamma: float = 0.2):
        self.neighbors: Dict[str, NeighborRecord] = {}
        self.alpha = alpha
        self.beta = beta
        self.gamma = gamma

    def update_neighbor(self, node_id: str, rssi: float, pdr: float, hop_dist: int):
        if node_id in self.neighbors:
            n = self.neighbors[node_id]
            # EMA Smoothing
            lambda_val = 0.7
            n.smoothed_rssi = lambda_val * rssi + (1 - lambda_val) * n.smoothed_rssi
            n.smoothed_pdr = lambda_val * pdr + (1 - lambda_val) * n.smoothed_pdr
            n.last_seen = time.time()
        else:
            self.neighbors[node_id] = NeighborRecord(node_id, time.time(), rssi, pdr, hop_dist)

    def prune_dead_nodes(self, t_dead: int = 45):
        now = time.time()
        dead = [nid for nid, n in self.neighbors.items() if now - n.last_seen > t_dead]
        for nid in dead:
            del self.neighbors[nid]
