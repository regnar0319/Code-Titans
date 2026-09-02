import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Optional

@dataclass
class CacheEntry:
    packet_hash: int
    timestamp: float
    ingress_node: str
    retransmit_count: int

class DeduplicationTable:
    def __init__(self, max_entries: int = 2048, ttl_seconds: int = 60):
        self.max_entries = max_entries
        self.ttl_seconds = ttl_seconds
        self.cache: OrderedDict[int, CacheEntry] = OrderedDict()
        self.stats = {"hits": 0, "misses": 0}

    def should_suppress(self, packet_hash: int) -> bool:
        now = time.time()
        # Clean expired
        while self.cache and now - next(iter(self.cache.values())).timestamp > self.ttl_seconds:
            self.cache.popitem(last=False)
            
        if packet_hash in self.cache:
            self.stats["hits"] += 1
            return True
        
        self.stats["misses"] += 1
        return False

    def insert(self, packet_hash: int, ingress_node: str):
        if len(self.cache) >= self.max_entries:
            self.cache.popitem(last=False)
        self.cache[packet_hash] = CacheEntry(packet_hash, time.time(), ingress_node, 0)
